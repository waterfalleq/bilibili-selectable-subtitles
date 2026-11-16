import {findActiveEpisodeIdInPageState} from "./core/media";
import {isRecord} from "./core/records";
import {
  AutomaticOcrController,
  type AutomaticOcrSnapshot
} from "./experiment/automaticOcr";
import {captureSubtitleRegion} from "./experiment/frameCapture";
import {
  createManualSubtitleOverlay,
  selectChineseOverlayText,
  type ManualSubtitleOverlay
} from "./experiment/manualOverlay";
import {detectActiveNativeChineseSubtitles} from "./experiment/nativeSubtitles";
import {
  decideAutomaticOcrRuntime,
  loadAutomaticOcrPreference,
  saveAutomaticOcrPreference
} from "./experiment/ocrPreference";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoverySuccess,
  OcrEngineMeasurement,
  OcrExperimentSuccess,
  PageHints,
  SubtitleTrackMetadata
} from "./shared/types";
import {
  createCompactPlayerControls,
  type CompactPlayerControls
} from "./ui/playerControls";

const PANEL_ID = "bso-diagnostic-panel";
const MESSAGE_TYPE = "BILIBILI_SUBTITLE_DIAGNOSTIC_DISCOVER";
const NATIVE_SUBTITLE_MONITOR_INTERVAL_MS = 1000;

let activeRequestId = "";
let lastContextFingerprint = "";
let contextCheckScheduled = false;
let automaticOcrPreferred = false;
let preferenceLoaded = false;
let contextReady = false;
let chineseNativeTrackAvailable = false;
let nativeChineseDetected = false;
let explicitOcrOverride = false;
let latestAutomaticSnapshot: AutomaticOcrSnapshot | undefined;
let lastAutomaticError = "";

const subtitleOverlay = createManualSubtitleOverlay();
const automaticOcr = new AutomaticOcrController(subtitleOverlay);
const panel = createPanel(subtitleOverlay);
let controls: CompactPlayerControls;

controls = createCompactPlayerControls({
  overlay: subtitleOverlay,
  onAutomaticAction: () => {
    if (automaticOcrPreferred) {
      automaticOcrPreferred = false;
      explicitOcrOverride = false;
    } else {
      automaticOcrPreferred = true;
      // Clicking Start is an explicit choice, including when native captions are active.
      explicitOcrOverride = true;
    }
    void saveAutomaticOcrPreference(automaticOcrPreferred).catch(() => {
      controls.showNotice("Could not save the automatic OCR preference.", "warning");
    });
    reconcileAutomaticOcr();
  },
  onAutomaticOverride: () => {
    automaticOcrPreferred = true;
    explicitOcrOverride = true;
    void saveAutomaticOcrPreference(true).catch(() => {
      controls.showNotice("Could not save the automatic OCR preference.", "warning");
    });
    reconcileAutomaticOcr();
  },
  onDebugVisibilityChange: (visible) => panel.setVisible(visible)
});

automaticOcr.subscribe((snapshot) => {
  latestAutomaticSnapshot = snapshot;
  panel.setAutomaticSnapshot(snapshot);
  renderAutomaticControlState();
  if (snapshot.mode === "error" && snapshot.detail !== lastAutomaticError) {
    lastAutomaticError = snapshot.detail;
    controls.showNotice("Automatic OCR encountered an error. Open Debug for details.", "error");
  }
});

document.addEventListener("fullscreenchange", syncUiContainers);
registerNavigationListeners();
window.setInterval(checkForNativeChineseSubtitles, NATIVE_SUBTITLE_MONITOR_INTERVAL_MS);
void restoreAutomaticOcrPreference();
void refreshIfContextChanged(true);

async function restoreAutomaticOcrPreference(): Promise<void> {
  try {
    automaticOcrPreferred = await loadAutomaticOcrPreference();
  } catch {
    automaticOcrPreferred = false;
    controls.showNotice("Could not load the saved OCR preference.", "warning");
  } finally {
    preferenceLoaded = true;
    reconcileAutomaticOcr();
  }
}

function reconcileAutomaticOcr(): void {
  if (!preferenceLoaded) {
    renderAutomaticControlState();
    return;
  }
  const decision = decideAutomaticOcrRuntime({
    preferred: automaticOcrPreferred,
    contextReady,
    nativeChineseActive: nativeChineseDetected,
    explicitOverride: explicitOcrOverride
  });
  if (decision === "run") automaticOcr.start();
  else if (automaticOcr.isEnabled()) automaticOcr.stop();
  renderAutomaticControlState();
}

function renderAutomaticControlState(): void {
  if (!latestAutomaticSnapshot) return;
  controls.setAutomaticState({
    preferenceLoaded,
    preferred: automaticOcrPreferred,
    suppressedByNative:
      automaticOcrPreferred && nativeChineseDetected && !explicitOcrOverride,
    snapshot: latestAutomaticSnapshot
  });
}

function checkForNativeChineseSubtitles(): void {
  if (!automaticOcrPreferred || explicitOcrOverride || nativeChineseDetected) return;
  if (!detectActiveNativeChineseSubtitles(chineseNativeTrackAvailable)) return;
  nativeChineseDetected = true;
  reconcileAutomaticOcr();
}

function registerNavigationListeners(): void {
  window.addEventListener("popstate", scheduleContextCheck);
  window.addEventListener("hashchange", scheduleContextCheck);
  window.addEventListener("pageshow", scheduleContextCheck);
  const navigation = (window as Window & {navigation?: EventTarget}).navigation;
  navigation?.addEventListener("navigate", scheduleContextCheck);
  document.addEventListener("click", schedulePostInteractionCheck, {capture: true});

  if (document.head) {
    const observer = new MutationObserver(scheduleContextCheck);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href"]
    });
  }
}

function schedulePostInteractionCheck(): void {
  window.setTimeout(scheduleContextCheck, 500);
  // Bilibili web fullscreen is a CSS mode and may replace player containers.
  window.setTimeout(syncUiContainers, 500);
}

function scheduleContextCheck(): void {
  if (contextCheckScheduled) return;
  contextCheckScheduled = true;
  window.setTimeout(() => {
    contextCheckScheduled = false;
    void refreshIfContextChanged(false);
  }, 150);
}

async function refreshIfContextChanged(force: boolean): Promise<void> {
  const hints = readPageHints();
  const fingerprint = `${location.href}|${hints.activeEpisodeId ?? ""}`;
  if (!force && fingerprint === lastContextFingerprint) return;
  lastContextFingerprint = fingerprint;

  // Stop the old runtime while the new media/native-track state is resolved.
  contextReady = false;
  chineseNativeTrackAvailable = false;
  nativeChineseDetected = false;
  explicitOcrOverride = false;
  if (automaticOcr.isEnabled()) automaticOcr.stop();
  else automaticOcr.invalidateForNavigation();
  syncUiContainers();
  renderAutomaticControlState();

  const requestId = createRequestId();
  activeRequestId = requestId;
  panel.renderLoading(location.href, hints);
  const request: DiscoveryRequest = {
    type: MESSAGE_TYPE,
    requestId,
    pageUrl: location.href,
    hints
  };

  let response: DiscoveryResponse;
  try {
    const rawResponse: unknown = await chrome.runtime.sendMessage(request);
    if (!isDiscoveryResponse(rawResponse)) {
      throw new Error("The extension service worker returned an invalid response.");
    }
    response = rawResponse;
  } catch (error) {
    if (requestId !== activeRequestId) return;
    const message = error instanceof Error ? error.message : "The extension service worker did not respond.";
    panel.renderFailure("SERVICE_WORKER_ERROR", message);
    controls.showNotice("Subtitle metadata is unavailable; OCR fallback is still available.", "warning");
    finishContextResolution(false);
    return;
  }

  if (requestId !== activeRequestId || response.requestId !== activeRequestId) return;
  if (response.ok) {
    panel.renderSuccess(response);
    finishContextResolution(response.chineseTracks.length > 0);
  } else {
    panel.renderFailure(response.error.code, response.error.message);
    controls.showNotice("Subtitle metadata is unavailable; OCR fallback is still available.", "warning");
    finishContextResolution(false);
  }
}

function finishContextResolution(chineseTrackAvailable: boolean): void {
  chineseNativeTrackAvailable = chineseTrackAvailable;
  nativeChineseDetected = detectActiveNativeChineseSubtitles(chineseTrackAvailable);
  contextReady = true;
  reconcileAutomaticOcr();
}

function readPageHints(): PageHints {
  const routeEpisode = location.pathname.match(/^\/bangumi\/play\/ep(\d+)/i)?.[1];
  if (routeEpisode) return {activeEpisodeId: Number(routeEpisode)};

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const canonicalEpisode = canonical?.match(/\/bangumi\/play\/ep(\d+)/i)?.[1];
  if (canonicalEpisode) return {activeEpisodeId: Number(canonicalEpisode)};

  const nextData = document.querySelector<HTMLScriptElement>("script#__NEXT_DATA__")?.textContent;
  if (nextData) {
    try {
      const episodeId = findActiveEpisodeIdInPageState(JSON.parse(nextData));
      if (episodeId) return {activeEpisodeId: episodeId};
    } catch {
      // A malformed page-state script is only a missing hint; API resolution continues.
    }
  }

  const activeEpisodeLink = document.querySelector<HTMLAnchorElement>(
    'a[aria-current="page"][href*="/bangumi/play/ep"], a[data-active="true"][href*="/bangumi/play/ep"]'
  );
  const activeEpisode = activeEpisodeLink?.href.match(/\/bangumi\/play\/ep(\d+)/i)?.[1];
  return activeEpisode ? {activeEpisodeId: Number(activeEpisode)} : {};
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

function isDiscoveryResponse(value: unknown): value is DiscoveryResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    typeof value.requestId === "string" &&
    (value.ok ? isRecord(value.identity) : isRecord(value.error))
  );
}

type DiagnosticState =
  | {kind: "loading"; url: string; hints: PageHints}
  | {kind: "success"; result: DiscoverySuccess}
  | {kind: "failure"; code: string; message: string};

interface DiagnosticPanel {
  setVisible: (visible: boolean) => void;
  syncContainer: () => void;
  renderLoading: (url: string, hints: PageHints) => void;
  renderSuccess: (result: DiscoverySuccess) => void;
  renderFailure: (code: string, message: string) => void;
  setAutomaticSnapshot: (snapshot: AutomaticOcrSnapshot) => void;
}

function createPanel(subtitleOverlay: ManualSubtitleOverlay): DiagnosticPanel {
  document.getElementById(PANEL_ID)?.remove();
  let visible = false;
  let root: HTMLElement | undefined;
  let status: HTMLParagraphElement | undefined;
  let details: HTMLDListElement | undefined;
  let tracks: HTMLUListElement | undefined;
  let automaticStatus: HTMLParagraphElement | undefined;
  let automaticMetrics: HTMLDListElement | undefined;
  let state: DiagnosticState = {kind: "loading", url: location.href, hints: {}};
  let automaticSnapshot: AutomaticOcrSnapshot | undefined;

  const ensureContent = (): void => {
    if (root) return;
    root = document.createElement("aside");
    root.id = PANEL_ID;
    root.hidden = true;
    root.dataset.tone = "neutral";
    root.setAttribute("aria-label", "Bilibili subtitle diagnostic status");

    const title = document.createElement("h2");
    title.className = "bso-diagnostic-title";
    title.textContent = "Subtitle discovery diagnostic";
    status = document.createElement("p");
    status.className = "bso-diagnostic-status";
    details = document.createElement("dl");
    tracks = document.createElement("ul");
    tracks.className = "bso-diagnostic-tracks";

    const automatic = document.createElement("section");
    automatic.className = "bso-automatic-ocr";
    const automaticHeading = document.createElement("h3");
    automaticHeading.textContent = "Automatic OCR runtime";
    automaticStatus = document.createElement("p");
    automaticStatus.className = "bso-automatic-status";
    automaticMetrics = document.createElement("dl");
    automaticMetrics.className = "bso-automatic-metrics";
    automatic.append(automaticHeading, automaticStatus, automaticMetrics);

    root.append(title, status, details, tracks, automatic, createOcrExperiment(subtitleOverlay).root);
  };

  const setDetails = (entries: Array<[string, string | number | boolean | undefined]>): void => {
    if (!details) return;
    details.replaceChildren();
    for (const [label, value] of entries) {
      if (value === undefined || value === "") continue;
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = String(value);
      details.append(term, description);
    }
  };

  const setTracks = (items: SubtitleTrackMetadata[]): void => {
    if (!tracks) return;
    tracks.replaceChildren();
    for (const track of items) {
      const item = document.createElement("li");
      const label = track.languageLabel || "Unlabelled";
      const code = track.languageCode || "no language code";
      item.textContent = `${label} (${code})${track.isAiGenerated ? " — AI" : ""}`;
      tracks.append(item);
    }
  };

  const renderState = (): void => {
    if (!visible || !root || !status) return;
    if (state.kind === "loading") {
      root.dataset.tone = "neutral";
      status.textContent = "Resolving the active media and requesting subtitle metadata…";
      setDetails([["Page", state.url], ["Episode hint", state.hints.activeEpisodeId]]);
      setTracks([]);
      return;
    }
    if (state.kind === "failure") {
      root.dataset.tone = "error";
      status.textContent = state.message;
      setDetails([["Status", "error"], ["Error code", state.code], ["Page", location.href]]);
      setTracks([]);
      return;
    }

    const result = state.result;
    root.dataset.tone = toneForStatus(result.status);
    status.textContent = result.note;
    setDetails([
      ["Page type", result.identity.pageType],
      ["Resolution", result.identity.resolutionSource],
      ["aid", result.identity.aid],
      ["bvid", result.identity.bvid],
      ["cid", result.identity.cid],
      ["Part", result.identity.pageNumber],
      ["Part title", result.identity.partTitle],
      ["Episode", result.identity.episodeId],
      ["Season", result.identity.seasonId],
      ["Episode title", result.identity.episodeTitle],
      ["Status", result.status],
      ["Selected source", result.source],
      ["Login gated", result.needLoginSubtitle],
      ["All tracks", result.totalTrackCount],
      ["Chinese tracks", result.chineseTracks.length],
      ...result.probes.flatMap((probe) => [
        [`${probe.source} probe`, probe.status] as [string, string],
        [`${probe.source} counts`, `${probe.rawTrackCount} raw / ${probe.usableTrackCount} usable / ${probe.chineseTrackCount} Chinese`] as [string, string],
        [`${probe.source} video type`, probe.requestVideoType] as [string, number | undefined],
        [`${probe.source} error`, probe.error ? `${probe.error.code}: ${probe.error.message}` : undefined] as [string, string | undefined]
      ])
    ]);
    setTracks(result.chineseTracks);
  };

  const renderAutomatic = (): void => {
    if (!visible || !automaticSnapshot || !automaticStatus || !automaticMetrics) return;
    automaticStatus.textContent = `${automaticSnapshot.mode}: ${automaticSnapshot.detail}`;
    const values = automaticSnapshot.metrics;
    renderMetrics(automaticMetrics, [
      ["OCR calls", `${values.ocrCalls} (${values.ocrCallsPerMinute.toFixed(1)}/min)`],
      ["Frame samples", String(values.samples)],
      ["Skipped unchanged", String(values.skippedUnchanged)],
      ["Skipped busy / hidden", `${values.skippedBusy} / ${values.skippedHidden}`],
      ["Stale results", String(values.staleResults)],
      ["Overlay DOM updates", String(values.domUpdates)],
      ["Last frame difference", values.lastDifference.toFixed(4)],
      ["Comparison avg / p95", `${values.comparisonAverageMs.toFixed(2)} / ${values.comparisonP95Ms.toFixed(2)} ms`],
      ["Inference avg / p95", `${values.inferenceAverageMs.toFixed(1)} / ${values.inferenceP95Ms.toFixed(1)} ms`],
      ["Appearance delay avg / p95", `${values.appearanceAverageMs.toFixed(1)} / ${values.appearanceP95Ms.toFixed(1)} ms`],
      ["Last confidence", values.lastConfidence === undefined ? "—" : `${values.lastConfidence.toFixed(1)}%`],
      ["Last regions", values.lastRegions === undefined ? "—" : String(values.lastRegions)],
      ["Last heap delta", values.lastHeapDeltaMiB === undefined ? "—" : `${values.lastHeapDeltaMiB >= 0 ? "+" : ""}${values.lastHeapDeltaMiB.toFixed(1)} MiB`]
    ]);
  };

  const syncContainer = (): void => {
    if (!root || !visible) return;
    const fullscreen = document.fullscreenElement;
    const container = fullscreen instanceof HTMLElement ? fullscreen : document.documentElement;
    if (root.parentElement !== container) container.append(root);
  };

  return {
    setVisible(value) {
      visible = value;
      if (visible) {
        ensureContent();
        if (!root) return;
        root.hidden = false;
        syncContainer();
        renderState();
        renderAutomatic();
      } else if (root) {
        root.hidden = true;
      }
    },
    syncContainer,
    renderLoading(url, hints) {
      state = {kind: "loading", url, hints};
      renderState();
    },
    renderSuccess(result) {
      state = {kind: "success", result};
      renderState();
    },
    renderFailure(code, message) {
      state = {kind: "failure", code, message};
      renderState();
    },
    setAutomaticSnapshot(snapshot) {
      automaticSnapshot = snapshot;
      renderAutomatic();
    }
  };
}

function createOcrExperiment(subtitleOverlay: ManualSubtitleOverlay): {root: HTMLElement} {
  const root = document.createElement("section");
  root.className = "bso-ocr-experiment";
  const heading = document.createElement("h3");
  heading.textContent = "Local frame/OCR experiment";
  const explanation = document.createElement("p");
  explanation.textContent = "Pause on a visible Chinese subtitle, then capture one frame. Nothing leaves this device.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Capture frame + run OCR";
  const result = document.createElement("p");
  result.className = "bso-ocr-result";
  result.textContent = "Not run.";
  const metrics = document.createElement("dl");
  metrics.className = "bso-ocr-metrics";
  const preview = document.createElement("img");
  preview.className = "bso-ocr-preview";
  preview.alt = "Captured lower video region for local OCR";
  preview.hidden = true;
  root.append(heading, explanation, button, result, metrics, preview);

  button.addEventListener("click", () => void runExperiment());
  async function runExperiment(): Promise<void> {
    button.disabled = true;
    result.textContent = "Capturing the current video frame…";
    metrics.replaceChildren();
    try {
      const capture = captureSubtitleRegion();
      preview.src = capture.dataUrl;
      preview.hidden = false;
      result.textContent = "Frame captured. Initializing/running local Chinese OCR…";
      const rawOcrResponse: unknown = await chrome.runtime.sendMessage({
        type: "BILIBILI_SUBTITLE_OCR_EXPERIMENT",
        imageDataUrl: capture.dataUrl
      });
      const ocr = requireOcrSuccess(rawOcrResponse);
      subtitleOverlay.setText(selectChineseOverlayText(ocr.results));
      result.textContent = ocr.results
        .map((measurement) => `${measurement.model}:\n${measurement.text || "(No text recognized.)"}`)
        .concat(ocr.engineErrors?.map((error) => `Engine error:\n${error}`) ?? [])
        .join("\n\n");
      renderMetrics(metrics, [
        ["Video time", formatSeconds(capture.videoTime)],
        ["Source frame", `${capture.videoWidth}×${capture.videoHeight}`],
        ["OCR crop", `${capture.cropWidth}×${capture.cropHeight} from source y=${capture.cropY}, h=${capture.sourceCropHeight}`],
        ["Capture", `${capture.captureMs.toFixed(1)} ms`],
        ...ocr.results.flatMap((measurement) => [
          [`${measurement.model} initialization`, `${measurement.initializationMs.toFixed(1)} ms`] as [string, string],
          [`${measurement.model} inference`, `${measurement.inferenceMs.toFixed(1)} ms`] as [string, string],
          [`${measurement.model} confidence`, `${measurement.confidence.toFixed(1)}%`] as [string, string],
          [`${measurement.model} backend`, measurement.backend ?? "not reported"] as [string, string],
          [`${measurement.model} regions`, String(measurement.detectedRegionCount ?? "not reported")] as [string, string],
          [`${measurement.model} heap delta`, formatHeapDelta(measurement)] as [string, string]
        ])
      ]);
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : "The frame/OCR experiment failed.";
    } finally {
      button.disabled = false;
    }
  }
  return {root};
}

function syncUiContainers(): void {
  subtitleOverlay.syncContainer();
  controls.syncContainer();
  panel.syncContainer();
}

function renderMetrics(list: HTMLDListElement, entries: Array<[string, string]>): void {
  list.replaceChildren();
  for (const [label, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

function requireOcrSuccess(value: unknown): OcrExperimentSuccess {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("The extension returned an invalid OCR response.");
  }
  if (!value.ok) {
    const error = isRecord(value.error) ? value.error : undefined;
    throw new Error(typeof error?.message === "string" ? error.message : "Local OCR failed.");
  }
  return value as unknown as OcrExperimentSuccess;
}

function formatHeapDelta(measurement: OcrEngineMeasurement): string {
  if (measurement.heapBeforeBytes === undefined || measurement.heapAfterBytes === undefined) {
    return "unavailable";
  }
  const delta = (measurement.heapAfterBytes - measurement.heapBeforeBytes) / (1024 * 1024);
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MiB (renderer estimate)`;
}

function toneForStatus(status: DiscoverySuccess["status"]): "success" | "warning" | "neutral" {
  if (status === "tracks-found") return "success";
  if (status === "login-required" || status === "no-chinese-tracks") return "warning";
  return "neutral";
}
