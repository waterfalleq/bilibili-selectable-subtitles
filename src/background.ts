import {DiagnosticError, toSafeError} from "./core/errors";
import {parseMediaRoute, resolveBangumiIdentity, resolveVideoIdentity} from "./core/media";
import {isRecord} from "./core/records";
import {parseSubtitleWebViewResponse} from "./core/subtitleWebView";
import {isChineseTrack, parseTrackDiscovery, type ParsedTrackDiscovery} from "./core/tracks";
import type {
  AutomaticOcrRequest,
  AutomaticOcrResponse,
  DiscoveryProbe,
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoverySuccess,
  MediaIdentity,
  MediaRoute,
  OcrExperimentRequest,
  OcrExperimentResponse,
  PageHints,
  SubtitleTrackMetadata
} from "./shared/types";

const API_ORIGIN = "https://api.bilibili.com";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isAutomaticOcrRequest(message)) {
    void runAutomaticOcr(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        const response: AutomaticOcrResponse = {ok: false, error: toSafeError(error)};
        sendResponse(response);
      });
    return true;
  }

  if (isOcrExperimentRequest(message)) {
    void runOcrExperiment(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        const response: OcrExperimentResponse = {ok: false, error: toSafeError(error)};
        sendResponse(response);
      });
    return true;
  }

  if (!isDiscoveryRequest(message)) return false;

  void discover(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const response: DiscoveryResponse = {
        ok: false,
        requestId: message.requestId,
        error: toSafeError(error)
      };
      sendResponse(response);
    });

  return true;
});

let creatingOffscreenDocument: Promise<void> | undefined;

async function runOcrExperiment(request: OcrExperimentRequest): Promise<OcrExperimentResponse> {
  await ensureOffscreenDocument();
  const response: unknown = await chrome.runtime.sendMessage({
    type: "BILIBILI_SUBTITLE_OCR_OFFSCREEN_RUN",
    imageDataUrl: request.imageDataUrl,
    mode: "experiment"
  });
  if (!isRecord(response) || typeof response.ok !== "boolean") {
    throw new DiagnosticError("INVALID_OCR_RESPONSE", "The local OCR document returned an invalid response.");
  }
  return response as unknown as OcrExperimentResponse;
}

async function runAutomaticOcr(request: AutomaticOcrRequest): Promise<AutomaticOcrResponse> {
  await ensureOffscreenDocument();
  const response: unknown = await chrome.runtime.sendMessage({
    type: "BILIBILI_SUBTITLE_OCR_OFFSCREEN_RUN",
    imageDataUrl: request.imageDataUrl,
    mode: "automatic"
  });
  if (!isRecord(response) || typeof response.ok !== "boolean") {
    throw new DiagnosticError("INVALID_OCR_RESPONSE", "The local OCR document returned an invalid response.");
  }
  return response as AutomaticOcrResponse;
}

async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [documentUrl]
  });
  if (contexts.length > 0) return;

  creatingOffscreenDocument ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run packaged local Chinese OCR away from the video page's main thread."
    })
    .finally(() => {
      creatingOffscreenDocument = undefined;
    });
  await creatingOffscreenDocument;
}

async function discover(request: DiscoveryRequest): Promise<DiscoveryResponse> {
  const route = parseMediaRoute(request.pageUrl);
  const identity = await resolveIdentity(route, request.hints);
  const [player, webView] = await Promise.all([
    probePlayerMetadata(identity),
    probeSubtitleWebView(identity)
  ]);

  return combineProbeResults(request.requestId, identity, player, webView);
}

interface PlayerProbeResult {
  probe: DiscoveryProbe;
  discovery?: ParsedTrackDiscovery;
}

interface WebViewProbeResult {
  probe: DiscoveryProbe;
  tracks?: SubtitleTrackMetadata[];
}

async function probePlayerMetadata(identity: MediaIdentity): Promise<PlayerProbeResult> {
  try {
    const payload = await fetchPlayerMetadata(identity);
    const discovery = parseTrackDiscovery(identity, payload);
    return {
      discovery,
      probe: {
        source: "player-wbi-v2",
        status:
          discovery.status === "login-required"
            ? "login-required"
            : discovery.totalTrackCount > 0
              ? "tracks"
              : "empty",
        rawTrackCount: discovery.totalTrackCount,
        usableTrackCount: discovery.totalTrackCount,
        chineseTrackCount: discovery.chineseTracks.length
      }
    };
  } catch (error) {
    return {probe: errorProbe("player-wbi-v2", error)};
  }
}

async function probeSubtitleWebView(identity: MediaIdentity): Promise<WebViewProbeResult> {
  const videoType = identity.pageType.startsWith("bangumi") ? 2 : 1;
  try {
    const bytes = await fetchSubtitleWebView(identity, videoType);
    const parsed = parseSubtitleWebViewResponse(bytes);
    const chineseTracks = parsed.tracks.filter(isChineseTrack);
    return {
      tracks: parsed.tracks,
      probe: {
        source: "subtitle-web-view",
        status: parsed.tracks.length > 0 ? "tracks" : "empty",
        rawTrackCount: parsed.rawTrackCount,
        usableTrackCount: parsed.tracks.length,
        chineseTrackCount: chineseTracks.length,
        requestVideoType: videoType
      }
    };
  } catch (error) {
    return {probe: {...errorProbe("subtitle-web-view", error), requestVideoType: videoType}};
  }
}

function combineProbeResults(
  requestId: string,
  identity: MediaIdentity,
  player: PlayerProbeResult,
  webView: WebViewProbeResult
): DiscoverySuccess {
  const probes = [player.probe, webView.probe];
  const playerChinese = player.discovery?.chineseTracks ?? [];
  const webChinese = webView.tracks?.filter(isChineseTrack) ?? [];

  if (playerChinese.length > 0) {
    return successWithTracks(
      requestId,
      identity,
      "player-wbi-v2",
      player.discovery?.totalTrackCount ?? playerChinese.length,
      playerChinese,
      player.discovery?.needLoginSubtitle ?? false,
      probes
    );
  }
  if (webChinese.length > 0) {
    return successWithTracks(
      requestId,
      identity,
      "subtitle-web-view",
      webView.tracks?.length ?? webChinese.length,
      webChinese,
      player.discovery?.needLoginSubtitle ?? false,
      probes
    );
  }

  const totalTrackCount = Math.max(
    player.discovery?.totalTrackCount ?? 0,
    webView.tracks?.length ?? 0
  );
  const needLoginSubtitle = player.discovery?.needLoginSubtitle ?? false;
  if (totalTrackCount > 0) {
    return {
      ok: true,
      requestId,
      identity,
      status: "no-chinese-tracks",
      needLoginSubtitle,
      totalTrackCount,
      chineseTracks: [],
      probes,
      note: "Subtitle tracks were reported, but neither API exposed a usable Chinese track."
    };
  }
  if (needLoginSubtitle) {
    return {
      ok: true,
      requestId,
      identity,
      status: "login-required",
      needLoginSubtitle,
      totalTrackCount: 0,
      chineseTracks: [],
      probes,
      note: "No tracks were returned and the player API explicitly reported a login requirement."
    };
  }

  const failedProbeCount = probes.filter((probe) => probe.status === "error").length;
  return {
    ok: true,
    requestId,
    identity,
    status: failedProbeCount === probes.length ? "discovery-inconclusive" : "no-tracks-reported",
    needLoginSubtitle,
    totalTrackCount: 0,
    chineseTracks: [],
    probes,
    note:
      failedProbeCount === probes.length
        ? "Both subtitle metadata probes failed; subtitle availability is inconclusive."
        : "Neither subtitle metadata API reported a usable track. This does not prove that visible captions are absent."
  };
}

function successWithTracks(
  requestId: string,
  identity: MediaIdentity,
  source: NonNullable<DiscoverySuccess["source"]>,
  totalTrackCount: number,
  chineseTracks: SubtitleTrackMetadata[],
  needLoginSubtitle: boolean,
  probes: DiscoveryProbe[]
): DiscoverySuccess {
  return {
    ok: true,
    requestId,
    identity,
    status: "tracks-found",
    needLoginSubtitle,
    totalTrackCount,
    chineseTracks,
    source,
    probes,
    note: `${chineseTracks.length} usable Chinese subtitle track(s) were reported by ${source}.`
  };
}

function errorProbe(source: DiscoveryProbe["source"], error: unknown): DiscoveryProbe {
  return {
    source,
    status: "error",
    rawTrackCount: 0,
    usableTrackCount: 0,
    chineseTrackCount: 0,
    error: toSafeError(error)
  };
}

async function resolveIdentity(route: MediaRoute, hints: PageHints): Promise<MediaIdentity> {
  if (route.kind === "video") {
    const query = new URLSearchParams({bvid: route.bvid});
    const payload = await fetchBilibiliJson(`/x/web-interface/view?${query}`);
    return resolveVideoIdentity(route, payload);
  }

  const query = new URLSearchParams(
    route.kind === "bangumi-episode"
      ? {ep_id: String(route.episodeId)}
      : {season_id: String(route.seasonId)}
  );
  const payload = await fetchBilibiliJson(`/pgc/view/web/season?${query}`);
  return resolveBangumiIdentity(route, payload, hints);
}

async function fetchPlayerMetadata(identity: MediaIdentity): Promise<unknown> {
  const query = new URLSearchParams({
    aid: String(identity.aid),
    bvid: identity.bvid,
    cid: String(identity.cid)
  });

  if (identity.episodeId) query.set("ep_id", String(identity.episodeId));
  if (identity.seasonId) query.set("season_id", String(identity.seasonId));

  return fetchBilibiliJson(`/x/player/wbi/v2?${query}`);
}

async function fetchSubtitleWebView(identity: MediaIdentity, videoType: number): Promise<Uint8Array> {
  const query = new URLSearchParams({
    oid: String(identity.cid),
    pid: String(identity.aid),
    context_ext: JSON.stringify({video_type: videoType}),
    type: "1",
    cur_production_type: "0",
    playlist_switch: "0"
  });
  let response: Response;

  try {
    response = await fetch(`${API_ORIGIN}/x/v2/subtitle/web/view?${query}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
  } catch {
    throw new DiagnosticError("NETWORK_ERROR", "The newer subtitle API request could not be completed.");
  }

  if (!response.ok) {
    throw new DiagnosticError(
      "HTTP_ERROR",
      `The newer subtitle API returned HTTP ${response.status}.`
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function fetchBilibiliJson(path: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
  } catch {
    throw new DiagnosticError("NETWORK_ERROR", "The Bilibili API request could not be completed.");
  }

  if (!response.ok) {
    throw new DiagnosticError(
      "HTTP_ERROR",
      `The Bilibili API returned HTTP ${response.status}.`
    );
  }

  try {
    return await response.json();
  } catch {
    throw new DiagnosticError("INVALID_JSON", "The Bilibili API response was not valid JSON.");
  }
}

function isDiscoveryRequest(value: unknown): value is DiscoveryRequest {
  return (
    isRecord(value) &&
    value.type === "BILIBILI_SUBTITLE_DIAGNOSTIC_DISCOVER" &&
    typeof value.requestId === "string" &&
    typeof value.pageUrl === "string" &&
    isRecord(value.hints)
  );
}

function isOcrExperimentRequest(value: unknown): value is OcrExperimentRequest {
  return (
    isRecord(value) &&
    value.type === "BILIBILI_SUBTITLE_OCR_EXPERIMENT" &&
    typeof value.imageDataUrl === "string" &&
    value.imageDataUrl.startsWith("data:image/png;base64,")
  );
}

function isAutomaticOcrRequest(value: unknown): value is AutomaticOcrRequest {
  return (
    isRecord(value) &&
    value.type === "BILIBILI_SUBTITLE_OCR_AUTOMATIC" &&
    typeof value.imageDataUrl === "string" &&
    value.imageDataUrl.startsWith("data:image/png;base64,")
  );
}
