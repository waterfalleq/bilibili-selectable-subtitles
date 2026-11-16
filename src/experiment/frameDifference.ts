const FINGERPRINT_WIDTH = 96;
const FINGERPRINT_HEIGHT = 24;
// Dataset/live calibration: 0.018 skipped short text-only changes on otherwise
// static ep399791 shots. 0.010 still rejects the observed 0.004-0.009 unchanged
// scores while preserving those brief subtitle transitions.
export const DEFAULT_FRAME_DIFFERENCE_THRESHOLD = 0.010;

export interface FrameFingerprintSample {
  fingerprint: Uint8Array;
  difference: number;
  overheadMs: number;
}

export function meanAbsoluteLumaDifference(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length || left.length === 0) return 1;
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index]! - right[index]!);
  }
  return total / (left.length * 255);
}

export class SubtitleRegionComparator {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private baseline: Uint8Array | undefined;

  constructor() {
    this.canvas.width = FINGERPRINT_WIDTH;
    this.canvas.height = FINGERPRINT_HEIGHT;
    const context = this.canvas.getContext("2d", {alpha: false, willReadFrequently: true});
    if (!context) throw new Error("Could not create the subtitle comparison canvas.");
    this.context = context;
  }

  sample(video: HTMLVideoElement): FrameFingerprintSample {
    const startedAt = performance.now();
    const cropY = Math.floor(video.videoHeight * 0.65);
    const cropBottom = Math.ceil(video.videoHeight * 0.98);
    this.context.drawImage(
      video,
      0,
      cropY,
      video.videoWidth,
      cropBottom - cropY,
      0,
      0,
      FINGERPRINT_WIDTH,
      FINGERPRINT_HEIGHT
    );
    const rgba = this.context.getImageData(0, 0, FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT).data;
    const fingerprint = new Uint8Array(FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
      fingerprint[target] = Math.round(
        rgba[source]! * 0.299 + rgba[source + 1]! * 0.587 + rgba[source + 2]! * 0.114
      );
    }
    return {
      fingerprint,
      difference: this.baseline ? meanAbsoluteLumaDifference(this.baseline, fingerprint) : 1,
      overheadMs: performance.now() - startedAt
    };
  }

  commit(fingerprint: Uint8Array): void {
    this.baseline = fingerprint;
  }

  reset(): void {
    this.baseline = undefined;
  }
}
