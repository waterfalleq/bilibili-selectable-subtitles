import {createWorker, OEM, PSM, type ImageLike, type Worker} from "tesseract.js";

export interface OcrMeasurement {
  text: string;
  confidence: number;
  initializationMs: number;
  inferenceMs: number;
  totalMs: number;
  heapBeforeBytes?: number;
  heapAfterBytes?: number;
  model: string;
}

let workerPromise: Promise<{worker: Worker; initializationMs: number}> | undefined;

export async function recognizeChineseSubtitle(image: string): Promise<OcrMeasurement> {
  return recognizeVariant(image, "original / single-line", PSM.SINGLE_LINE);
}

export async function recognizeChineseSubtitleVariants(image: string): Promise<OcrMeasurement[]> {
  const processed = await createPreprocessedImages(image);
  return [
    await recognizeVariant(image, "original / single-line", PSM.SINGLE_LINE),
    await recognizeVariant(processed.contrast, "grayscale+contrast / single-line", PSM.SINGLE_LINE),
    await recognizeVariant(processed.threshold, "Otsu white-text mask / raw-line", PSM.RAW_LINE)
  ];
}

async function recognizeVariant(
  image: ImageLike,
  variant: string,
  pageSegmentationMode: PSM
): Promise<OcrMeasurement> {
  const totalStartedAt = performance.now();
  const heapBeforeBytes = readHeapSize();
  const {worker, initializationMs} = await getWorker();
  await worker.setParameters({tessedit_pageseg_mode: pageSegmentationMode});
  const inferenceStartedAt = performance.now();
  const result = await worker.recognize(image, {}, {text: true});
  const inferenceMs = performance.now() - inferenceStartedAt;

  const measurement: OcrMeasurement = {
    text: normalizeOcrText(result.data.text),
    confidence: result.data.confidence,
    initializationMs,
    inferenceMs,
    totalMs: performance.now() - totalStartedAt,
    model: `Tesseract.js chi_sim best_int — ${variant}`
  };
  const heapAfterBytes = readHeapSize();
  if (heapBeforeBytes !== undefined) measurement.heapBeforeBytes = heapBeforeBytes;
  if (heapAfterBytes !== undefined) measurement.heapAfterBytes = heapAfterBytes;
  return measurement;
}

function getWorker(): Promise<{worker: Worker; initializationMs: number}> {
  workerPromise ??= initializeWorker().catch((error: unknown) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

async function initializeWorker(): Promise<{worker: Worker; initializationMs: number}> {
  const startedAt = performance.now();
  const assetRoot = chrome.runtime.getURL("tesseract/");
  const worker = await createWorker(
    "chi_sim",
    OEM.LSTM_ONLY,
    {
      workerPath: `${assetRoot}worker.min.js`,
      corePath: `${assetRoot}core/`,
      langPath: `${assetRoot}lang/`,
      workerBlobURL: false,
      gzip: true,
      logger: () => undefined
    },
    {
      load_system_dawg: "0",
      load_freq_dawg: "0"
    }
  );

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: "1",
    user_defined_dpi: "150"
  });

  return {worker, initializationMs: performance.now() - startedAt};
}

async function createPreprocessedImages(image: string): Promise<{
  contrast: string;
  threshold: string;
}> {
  const bitmap = await createImageBitmap(await (await fetch(image)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
  if (!context) throw new Error("Could not create the Tesseract preprocessing canvas.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const original = context.getImageData(0, 0, canvas.width, canvas.height);

  const contrast = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
  for (let index = 0; index < contrast.data.length; index += 4) {
    const luminance = pixelLuminance(contrast.data, index);
    const boosted = Math.max(0, Math.min(255, Math.round((luminance - 128) * 1.45 + 128)));
    contrast.data[index] = contrast.data[index + 1] = contrast.data[index + 2] = boosted;
  }

  const thresholdValue = otsuThreshold(original.data);
  const threshold = new ImageData(original.width, original.height);
  for (let index = 0; index < original.data.length; index += 4) {
    // Convert bright subtitle cores to black on white for Tesseract. This is a
    // diagnostic variant, not a production assumption about every subtitle style.
    const value = pixelLuminance(original.data, index) >= thresholdValue ? 0 : 255;
    threshold.data[index] = threshold.data[index + 1] = threshold.data[index + 2] = value;
    threshold.data[index + 3] = 255;
  }
  return {
    contrast: imageDataToDataUrl(contrast),
    threshold: imageDataToDataUrl(threshold)
  };
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d", {alpha: false});
  if (!context) throw new Error("Could not encode a Tesseract preprocessing variant.");
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function pixelLuminance(data: Uint8ClampedArray, index: number): number {
  return Math.round(
    (data[index] ?? 0) * 0.299 +
    (data[index + 1] ?? 0) * 0.587 +
    (data[index + 2] ?? 0) * 0.114
  );
}

function otsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256);
  let total = 0;
  let weightedTotal = 0;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = pixelLuminance(data, index);
    histogram[luminance] = (histogram[luminance] ?? 0) + 1;
    total += 1;
    weightedTotal += luminance;
  }
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 180;
  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    backgroundWeight += histogram[threshold] ?? 0;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += threshold * (histogram[threshold] ?? 0);
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

function normalizeOcrText(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter(Boolean)
    .join("\n");
}

function readHeapSize(): number | undefined {
  const memory = (performance as Performance & {memory?: {usedJSHeapSize?: number}}).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : undefined;
}
