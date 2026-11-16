export interface CapturedSubtitleRegion {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  videoWidth: number;
  videoHeight: number;
  cropY: number;
  sourceCropHeight: number;
  cropWidth: number;
  cropHeight: number;
  captureMs: number;
  videoTime: number;
}

export interface SubtitleCaptureOptions {
  targetWidth?: number;
  cropTopRatio?: number;
  cropBottomRatio?: number;
}

// Subtitle placement varies between Bangumi masters. Keep the original colour
// pixels from the lower third and let the PP-OCR detector localize the line.
// This is still a much smaller input than a full frame, but avoids the false
// assumption that every title uses ep815578's 76–90% band.
const CROP_TOP_RATIO = 0.65;
const CROP_BOTTOM_RATIO = 0.98;
const TARGET_OCR_WIDTH = 1600;
const MAX_SCALE = 3;

export function captureSubtitleRegion(options: SubtitleCaptureOptions = {}): CapturedSubtitleRegion {
  const video = findActiveVideo();
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error("No ready Bilibili video element was found.");
  }
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("The active video has no decoded frame dimensions yet.");
  }

  const startedAt = performance.now();
  const cropTopRatio = options.cropTopRatio ?? CROP_TOP_RATIO;
  const cropBottomRatio = options.cropBottomRatio ?? CROP_BOTTOM_RATIO;
  const targetWidth = options.targetWidth ?? TARGET_OCR_WIDTH;
  const cropY = Math.floor(video.videoHeight * cropTopRatio);
  const cropBottom = Math.ceil(video.videoHeight * cropBottomRatio);
  const cropHeight = cropBottom - cropY;
  const scale = Math.min(MAX_SCALE, targetWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(cropHeight * scale);

  const context = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
  if (!context) throw new Error("Chrome could not create a 2D canvas context.");

  try {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      video,
      0,
      cropY,
      video.videoWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    // Reading one pixel and encoding the canvas proves that it is not tainted.
    context.getImageData(0, 0, 1, 1);
    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length < 100) throw new Error("Chrome encoded an unexpectedly empty frame.");

    return {
      canvas,
      dataUrl,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      cropY,
      sourceCropHeight: cropBottom - cropY,
      cropWidth: canvas.width,
      cropHeight: canvas.height,
      captureMs: performance.now() - startedAt,
      videoTime: video.currentTime
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new Error("Direct video capture was blocked because the canvas became origin-tainted.");
    }
    throw error;
  }
}

export function findActiveVideo(): HTMLVideoElement | undefined {
  return [...document.querySelectorAll<HTMLVideoElement>("video")]
    .filter((video) => video.getBoundingClientRect().width > 0 && video.getBoundingClientRect().height > 0)
    .sort((left, right) => visibleArea(right) - visibleArea(left))[0];
}

function visibleArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  return rect.width * rect.height;
}
