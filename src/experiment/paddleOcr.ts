import * as ort from "onnxruntime-web";
import {PaddleOcrService} from "ppu-paddle-ocr/web";
import type {OcrEngineMeasurement} from "../shared/types";

const MODEL_ROOT = "ppocrv5/";
const TARGET_LONG_SIDE = 1600;
const MIN_INPUT_LONG_SIDE = 1100;
const MAX_UPSCALE = 4;

let servicePromise: Promise<{service: PaddleOcrService; initializationMs: number}> | undefined;
let recognitionTail: Promise<void> = Promise.resolve();

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8))
  : 1;
ort.env.logLevel = "error";

export async function recognizePaddleChineseSubtitle(
  imageDataUrl: string
): Promise<OcrEngineMeasurement> {
  const job = recognitionTail.then(() => runRecognition(imageDataUrl));
  recognitionTail = job.then(() => undefined, () => undefined);
  return job;
}

async function runRecognition(imageDataUrl: string): Promise<OcrEngineMeasurement> {
  const totalStartedAt = performance.now();
  const heapBeforeBytes = readHeapSize();
  const {service, initializationMs} = await getService();
  const input = await prepareImage(imageDataUrl);
  const inferenceStartedAt = performance.now();
  const result = await service.recognize(input, {
    flatten: false,
    strategy: "per-line",
    noCache: true
  });
  const inferenceMs = performance.now() - inferenceStartedAt;
  const heapAfterBytes = readHeapSize();
  const detectedRegionCount = result.lines.reduce((total, line) => total + line.length, 0);

  return {
    text: normalizeChineseText(result.text),
    confidence: result.confidence * 100,
    initializationMs,
    inferenceMs,
    totalMs: performance.now() - totalStartedAt,
    model: "PP-OCRv5 Chinese det+rec",
    backend: `WASM (${ort.env.wasm.numThreads} thread${ort.env.wasm.numThreads === 1 ? "" : "s"})`,
    detectedRegionCount,
    ...(heapBeforeBytes === undefined ? {} : {heapBeforeBytes}),
    ...(heapAfterBytes === undefined ? {} : {heapAfterBytes})
  };
}

function getService(): Promise<{service: PaddleOcrService; initializationMs: number}> {
  servicePromise ??= initializeService().catch((error: unknown) => {
    servicePromise = undefined;
    throw error;
  });
  return servicePromise;
}

async function initializeService(): Promise<{
  service: PaddleOcrService;
  initializationMs: number;
}> {
  const startedAt = performance.now();
  const asset = (name: string): string => chrome.runtime.getURL(`${MODEL_ROOT}${name}`);
  const service = new PaddleOcrService({
    model: {
      detection: asset("PP-OCRv5_mobile_det_infer.onnx"),
      recognition: asset("PP-OCRv5_mobile_rec_infer.onnx"),
      charactersDictionary: asset("ppocrv5_dict.txt")
    },
    session: {
      // PP-OCRv5 recognition contains recurrent operators that are not reliably
      // WebGPU-resident in ORT Web. Force the measured, deterministic fallback.
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3
    },
    processing: {engine: "canvas-native"},
    detection: {
      maxSideLength: TARGET_LONG_SIDE,
      minimumAreaThreshold: 20,
      paddingVertical: 0.25,
      paddingHorizontal: 0.35
    },
    recognition: {
      strategy: "per-line",
      imageHeight: 48,
      charactersDictionary: []
    }
  });
  await service.initialize();
  return {service, initializationMs: performance.now() - startedAt};
}

async function prepareImage(imageDataUrl: string): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(await (await fetch(imageDataUrl)).blob());
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = longSide < MIN_INPUT_LONG_SIDE
    ? Math.min(MAX_UPSCALE, MIN_INPUT_LONG_SIDE / longSide)
    : 1;
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale)
  );
  const context = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
  if (!context) throw new Error("Could not create the PP-OCR input canvas.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function normalizeChineseText(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, ""))
    .filter(Boolean)
    .join("\n");
}

function readHeapSize(): number | undefined {
  const memory = (performance as Performance & {memory?: {usedJSHeapSize?: number}}).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : undefined;
}
