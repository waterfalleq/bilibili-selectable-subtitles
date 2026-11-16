import {isRecord} from "../core/records";
import type {AutomaticOcrResponse, OcrEngineMeasurement} from "../shared/types";
import {captureSubtitleRegion, findActiveVideo} from "./frameCapture";
import {
  DEFAULT_FRAME_DIFFERENCE_THRESHOLD,
  SubtitleRegionComparator
} from "./frameDifference";
import type {ManualSubtitleOverlay} from "./manualOverlay";
import {selectChineseOverlayText} from "./manualOverlay";
import {OcrGeneration, SubtitleStabilizer} from "./automaticOcrState";

const SAMPLE_INTERVAL_MS = 500;
const VIDEO_MONITOR_INTERVAL_MS = 750;
const STAT_WINDOW_SIZE = 240;
const AUTOMATIC_CAPTURE_WIDTH = 1600;
const AUTOMATIC_CROP_TOP_RATIO = 0.75;

export type AutomaticOcrMode =
  | "off"
  | "waiting-video"
  | "paused"
  | "hidden"
  | "sampling"
  | "recognizing"
  | "ended"
  | "error";

export interface AutomaticOcrMetrics {
  samples: number;
  ocrCalls: number;
  ocrCallsPerMinute: number;
  skippedUnchanged: number;
  skippedBusy: number;
  skippedHidden: number;
  staleResults: number;
  domUpdates: number;
  comparisonAverageMs: number;
  comparisonP95Ms: number;
  inferenceAverageMs: number;
  inferenceP95Ms: number;
  appearanceAverageMs: number;
  appearanceP95Ms: number;
  lastDifference: number;
  lastConfidence?: number;
  lastRegions?: number;
  lastHeapDeltaMiB?: number;
}

export interface AutomaticOcrSnapshot {
  enabled: boolean;
  mode: AutomaticOcrMode;
  detail: string;
  metrics: AutomaticOcrMetrics;
}

type SnapshotListener = (snapshot: AutomaticOcrSnapshot) => void;

export class AutomaticOcrController {
  private readonly comparator = new SubtitleRegionComparator();
  private readonly stabilizer = new SubtitleStabilizer();
  private readonly generation = new OcrGeneration();
  private readonly listeners = new Set<SnapshotListener>();
  private video: HTMLVideoElement | undefined;
  private enabled = false;
  private mode: AutomaticOcrMode = "off";
  private detail = "Automatic OCR is off.";
  private inFlight = false;
  private scheduledFrameId: number | undefined;
  private scheduledTimerId: number | undefined;
  private monitorId: number | undefined;
  private lastSampleAt = 0;
  private sessionStartedAt = 0;
  private pendingAppearanceStartedAt: number | undefined;
  private samples = 0;
  private ocrCalls = 0;
  private skippedUnchanged = 0;
  private skippedBusy = 0;
  private skippedHidden = 0;
  private staleResults = 0;
  private domUpdates = 0;
  private lastDifference = 0;
  private lastConfidence: number | undefined;
  private lastRegions: number | undefined;
  private lastHeapDeltaMiB: number | undefined;
  private comparisonTotalMs = 0;
  private inferenceTotalMs = 0;
  private appearanceTotalMs = 0;
  private readonly comparisonTimes: number[] = [];
  private readonly inferenceTimes: number[] = [];
  private readonly appearanceTimes: number[] = [];

  constructor(private readonly overlay: ManualSubtitleOverlay) {}

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.sessionStartedAt = performance.now();
    this.resetMetrics();
    this.invalidateState(true);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.monitorId = window.setInterval(() => this.bindActiveVideo(), VIDEO_MONITOR_INTERVAL_MS);
    this.bindActiveVideo();
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.generation.invalidate();
    this.cancelScheduledSample();
    if (this.monitorId !== undefined) window.clearInterval(this.monitorId);
    this.monitorId = undefined;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.detachVideo();
    this.stabilizer.reset();
    this.comparator.reset();
    this.pendingAppearanceStartedAt = undefined;
    this.overlay.clear();
    this.setStatus("off", "Automatic OCR is off.");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  invalidateForNavigation(): void {
    this.invalidateState(true);
    if (this.enabled) this.bindActiveVideo();
  }

  private readonly handleVisibilityChange = (): void => {
    if (!this.enabled) return;
    if (document.hidden) {
      this.cancelScheduledSample();
      this.setStatus("hidden", "Automatic OCR is suspended while this tab is hidden.");
    } else {
      this.bindActiveVideo();
      this.scheduleSample();
    }
  };

  private readonly handlePlay = (): void => {
    this.setStatus("sampling", "Watching the subtitle region for changes.");
    this.scheduleSample();
  };

  private readonly handlePause = (): void => {
    this.cancelScheduledSample();
    this.setStatus("paused", "Paused; the confirmed subtitle is preserved.");
  };

  private readonly handleEnded = (): void => {
    this.cancelScheduledSample();
    this.setStatus("ended", "Playback ended; automatic OCR is waiting.");
  };

  private readonly handleSeeking = (): void => {
    this.cancelScheduledSample();
    this.invalidateState(true);
    this.setStatus("sampling", "Seek detected; stale OCR results were invalidated.");
  };

  private readonly handleSeeked = (): void => {
    this.lastSampleAt = 0;
    this.scheduleSample();
  };

  private bindActiveVideo(): void {
    if (!this.enabled) return;
    const active = findActiveVideo();
    if (active === this.video) {
      this.scheduleSample();
      return;
    }

    this.detachVideo();
    this.generation.invalidate();
    this.stabilizer.reset();
    this.comparator.reset();
    this.pendingAppearanceStartedAt = undefined;
    this.overlay.clear();
    this.video = active;

    if (!active) {
      this.setStatus("waiting-video", "Waiting for a ready video element.");
      return;
    }
    active.addEventListener("play", this.handlePlay);
    active.addEventListener("pause", this.handlePause);
    active.addEventListener("ended", this.handleEnded);
    active.addEventListener("seeking", this.handleSeeking);
    active.addEventListener("seeked", this.handleSeeked);
    active.addEventListener("ratechange", this.emitSnapshot);

    if (active.ended) this.setStatus("ended", "Playback ended; automatic OCR is waiting.");
    else if (active.paused) this.setStatus("paused", "Ready; start playback to begin automatic OCR.");
    else this.handlePlay();
  }

  private detachVideo(): void {
    const video = this.video;
    if (!video) return;
    this.cancelScheduledSample();
    video.removeEventListener("play", this.handlePlay);
    video.removeEventListener("pause", this.handlePause);
    video.removeEventListener("ended", this.handleEnded);
    video.removeEventListener("seeking", this.handleSeeking);
    video.removeEventListener("seeked", this.handleSeeked);
    video.removeEventListener("ratechange", this.emitSnapshot);
    this.video = undefined;
  }

  private scheduleSample(): void {
    const video = this.video;
    if (
      !this.enabled || !video || video.paused || video.ended || document.hidden || this.inFlight ||
      this.scheduledFrameId !== undefined || this.scheduledTimerId !== undefined
    ) return;

    if (typeof video.requestVideoFrameCallback === "function") {
      this.scheduledFrameId = video.requestVideoFrameCallback((now) => {
        this.scheduledFrameId = undefined;
        if (video !== this.video) return;
        if (now - this.lastSampleAt < SAMPLE_INTERVAL_MS) {
          this.scheduleSample();
          return;
        }
        this.lastSampleAt = now;
        void this.sampleFrame().finally(() => this.scheduleSample());
      });
      return;
    }

    this.scheduledTimerId = window.setTimeout(() => {
      this.scheduledTimerId = undefined;
      this.lastSampleAt = performance.now();
      void this.sampleFrame().finally(() => this.scheduleSample());
    }, SAMPLE_INTERVAL_MS);
  }

  private cancelScheduledSample(): void {
    if (this.scheduledFrameId !== undefined && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.scheduledFrameId);
    }
    if (this.scheduledTimerId !== undefined) window.clearTimeout(this.scheduledTimerId);
    this.scheduledFrameId = undefined;
    this.scheduledTimerId = undefined;
  }

  private async sampleFrame(): Promise<void> {
    const video = this.video;
    if (!this.enabled || !video || video.paused || video.ended) return;
    if (document.hidden) {
      this.skippedHidden += 1;
      this.setStatus("hidden", "Automatic OCR is suspended while this tab is hidden.");
      return;
    }
    if (this.inFlight) {
      this.skippedBusy += 1;
      this.emitSnapshot();
      return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return;

    try {
      const comparison = this.comparator.sample(video);
      this.samples += 1;
      this.lastDifference = comparison.difference;
      this.comparisonTotalMs += comparison.overheadMs;
      pushBounded(this.comparisonTimes, comparison.overheadMs);
      const forceConfirmation = this.stabilizer.needsFollowUp();
      if (comparison.difference < DEFAULT_FRAME_DIFFERENCE_THRESHOLD && !forceConfirmation) {
        this.skippedUnchanged += 1;
        this.setStatus("sampling", "Subtitle region unchanged; full OCR skipped.");
        return;
      }

      this.comparator.commit(comparison.fingerprint);
      if (this.pendingAppearanceStartedAt === undefined) {
        this.pendingAppearanceStartedAt = performance.now();
      }
      await this.runOcr(video);
    } catch (error) {
      this.comparator.reset();
      this.setStatus("error", error instanceof Error ? error.message : "Automatic OCR failed.");
    }
  }

  private async runOcr(video: HTMLVideoElement): Promise<void> {
    const capturedGeneration = this.generation.capture();
    const capture = captureSubtitleRegion({
      targetWidth: AUTOMATIC_CAPTURE_WIDTH,
      cropTopRatio: AUTOMATIC_CROP_TOP_RATIO,
      cropBottomRatio: 0.98
    });
    this.inFlight = true;
    this.ocrCalls += 1;
    this.setStatus("recognizing", "Running local PP-OCRv5…");
    try {
      const raw: unknown = await chrome.runtime.sendMessage({
        type: "BILIBILI_SUBTITLE_OCR_AUTOMATIC",
        imageDataUrl: capture.dataUrl
      });
      const response = requireAutomaticSuccess(raw);
      if (!this.generation.isCurrent(capturedGeneration) || video !== this.video || !this.enabled) {
        this.staleResults += 1;
        return;
      }

      const measurement = response.measurement;
      this.recordMeasurement(measurement);
      const text = selectChineseOverlayText([measurement]);
      const transition = this.stabilizer.observe({text, confidence: measurement.confidence});
      if (transition.type === "display") {
        this.overlay.setText(transition.text);
        this.domUpdates += 1;
        this.recordAppearanceDelay();
      } else if (transition.type === "clear") {
        this.overlay.clear();
        this.domUpdates += 1;
        this.pendingAppearanceStartedAt = undefined;
      } else if (transition.reason !== "candidate" && transition.reason !== "possible-clear") {
        this.pendingAppearanceStartedAt = undefined;
      }
      this.setStatus("sampling", statusForTransition(transition.type, transition.type === "none" ? transition.reason : undefined));
    } finally {
      this.inFlight = false;
    }
  }

  private invalidateState(clearOverlay: boolean): void {
    this.generation.invalidate();
    this.stabilizer.reset();
    this.comparator.reset();
    this.pendingAppearanceStartedAt = undefined;
    this.lastSampleAt = 0;
    if (clearOverlay) this.overlay.clear();
  }

  private recordMeasurement(measurement: OcrEngineMeasurement): void {
    this.inferenceTotalMs += measurement.inferenceMs;
    pushBounded(this.inferenceTimes, measurement.inferenceMs);
    this.lastConfidence = measurement.confidence;
    this.lastRegions = measurement.detectedRegionCount;
    if (measurement.heapBeforeBytes !== undefined && measurement.heapAfterBytes !== undefined) {
      this.lastHeapDeltaMiB = (measurement.heapAfterBytes - measurement.heapBeforeBytes) / (1024 * 1024);
    }
  }

  private recordAppearanceDelay(): void {
    if (this.pendingAppearanceStartedAt === undefined) return;
    const delay = performance.now() - this.pendingAppearanceStartedAt;
    this.appearanceTotalMs += delay;
    pushBounded(this.appearanceTimes, delay);
    this.pendingAppearanceStartedAt = undefined;
  }

  private resetMetrics(): void {
    this.samples = this.ocrCalls = this.skippedUnchanged = this.skippedBusy = 0;
    this.skippedHidden = this.staleResults = this.domUpdates = 0;
    this.lastDifference = 0;
    this.lastConfidence = this.lastRegions = this.lastHeapDeltaMiB = undefined;
    this.comparisonTotalMs = this.inferenceTotalMs = this.appearanceTotalMs = 0;
    this.comparisonTimes.length = this.inferenceTimes.length = this.appearanceTimes.length = 0;
  }

  private readonly emitSnapshot = (): void => {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  };

  private setStatus(mode: AutomaticOcrMode, detail: string): void {
    this.mode = mode;
    this.detail = detail;
    this.emitSnapshot();
  }

  private snapshot(): AutomaticOcrSnapshot {
    const elapsedMinutes = Math.max((performance.now() - this.sessionStartedAt) / 60_000, 1 / 60);
    return {
      enabled: this.enabled,
      mode: this.mode,
      detail: this.detail,
      metrics: {
        samples: this.samples,
        ocrCalls: this.ocrCalls,
        ocrCallsPerMinute: this.enabled ? this.ocrCalls / elapsedMinutes : 0,
        skippedUnchanged: this.skippedUnchanged,
        skippedBusy: this.skippedBusy,
        skippedHidden: this.skippedHidden,
        staleResults: this.staleResults,
        domUpdates: this.domUpdates,
        comparisonAverageMs: average(this.comparisonTotalMs, this.samples),
        comparisonP95Ms: percentile(this.comparisonTimes, 0.95),
        inferenceAverageMs: average(this.inferenceTotalMs, this.inferenceTimes.length),
        inferenceP95Ms: percentile(this.inferenceTimes, 0.95),
        appearanceAverageMs: average(this.appearanceTotalMs, this.appearanceTimes.length),
        appearanceP95Ms: percentile(this.appearanceTimes, 0.95),
        lastDifference: this.lastDifference,
        ...(this.lastConfidence === undefined ? {} : {lastConfidence: this.lastConfidence}),
        ...(this.lastRegions === undefined ? {} : {lastRegions: this.lastRegions}),
        ...(this.lastHeapDeltaMiB === undefined ? {} : {lastHeapDeltaMiB: this.lastHeapDeltaMiB})
      }
    };
  }
}

function requireAutomaticSuccess(value: unknown): Extract<AutomaticOcrResponse, {ok: true}> {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.measurement)) {
    if (isRecord(value) && value.ok === false && isRecord(value.error) && typeof value.error.message === "string") {
      throw new Error(value.error.message);
    }
    throw new Error("The automatic OCR service returned an invalid response.");
  }
  return value as unknown as Extract<AutomaticOcrResponse, {ok: true}>;
}

function statusForTransition(
  type: "none" | "display" | "clear",
  reason?: "empty" | "inconclusive" | "unchanged" | "candidate" | "possible-clear"
): string {
  if (type === "display") return "Confirmed subtitle displayed.";
  if (type === "clear") return "Confirmed subtitle disappearance; overlay cleared.";
  if (reason === "candidate") return "Candidate subtitle detected; awaiting confirmation.";
  if (reason === "possible-clear") return "Possible subtitle gap; awaiting confirmation.";
  if (reason === "inconclusive") return "Low-confidence result ignored; confirmed subtitle preserved.";
  if (reason === "unchanged") return "Recognized subtitle unchanged; DOM update skipped.";
  return "No Chinese subtitle detected.";
}

function pushBounded(values: number[], value: number): void {
  values.push(value);
  if (values.length > STAT_WINDOW_SIZE) values.splice(0, values.length - STAT_WINDOW_SIZE);
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}
