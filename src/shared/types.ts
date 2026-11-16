export type PageType =
  | "regular-video"
  | "multipart-video"
  | "bangumi-episode"
  | "bangumi-season";

export type ResolutionSource = "route" | "page-hint" | "season-default";

export interface PageHints {
  activeEpisodeId?: number;
}

export interface MediaIdentity {
  pageType: PageType;
  aid: number;
  bvid: string;
  cid: number;
  pageNumber?: number;
  partTitle?: string;
  episodeId?: number;
  seasonId?: number;
  episodeTitle?: string;
  resolutionSource: ResolutionSource;
}

export interface SubtitleTrackMetadata {
  id: string;
  languageCode: string;
  languageLabel: string;
  isAiGenerated: boolean;
}

export type SubtitleDiscoverySource = "player-wbi-v2" | "subtitle-web-view";

export interface DiscoveryProbe {
  source: SubtitleDiscoverySource;
  status: "tracks" | "empty" | "login-required" | "error";
  rawTrackCount: number;
  usableTrackCount: number;
  chineseTrackCount: number;
  requestVideoType?: number;
  error?: {
    code: string;
    message: string;
  };
}

export type DiscoveryStatus =
  | "tracks-found"
  | "login-required"
  | "no-chinese-tracks"
  | "no-tracks-reported"
  | "discovery-inconclusive";

export interface DiscoverySuccess {
  ok: true;
  requestId: string;
  identity: MediaIdentity;
  status: DiscoveryStatus;
  needLoginSubtitle: boolean;
  totalTrackCount: number;
  chineseTracks: SubtitleTrackMetadata[];
  source?: SubtitleDiscoverySource;
  probes: DiscoveryProbe[];
  note: string;
}

export interface DiscoveryFailure {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export type DiscoveryResponse = DiscoverySuccess | DiscoveryFailure;

export interface DiscoveryRequest {
  type: "BILIBILI_SUBTITLE_DIAGNOSTIC_DISCOVER";
  requestId: string;
  pageUrl: string;
  hints: PageHints;
}

export interface OcrExperimentRequest {
  type: "BILIBILI_SUBTITLE_OCR_EXPERIMENT";
  imageDataUrl: string;
}

export interface AutomaticOcrRequest {
  type: "BILIBILI_SUBTITLE_OCR_AUTOMATIC";
  imageDataUrl: string;
}

export interface OcrEngineMeasurement {
  text: string;
  confidence: number;
  initializationMs: number;
  inferenceMs: number;
  totalMs: number;
  heapBeforeBytes?: number;
  heapAfterBytes?: number;
  model: string;
  backend?: string;
  detectedRegionCount?: number;
}

export interface OcrExperimentSuccess {
  ok: true;
  results: OcrEngineMeasurement[];
  engineErrors?: string[];
}

export interface OcrExperimentFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type OcrExperimentResponse = OcrExperimentSuccess | OcrExperimentFailure;

export type AutomaticOcrResponse =
  | {ok: true; measurement: OcrEngineMeasurement}
  | OcrExperimentFailure;

export interface OcrOffscreenRequest {
  type: "BILIBILI_SUBTITLE_OCR_OFFSCREEN_RUN";
  imageDataUrl: string;
  mode: "experiment" | "automatic";
}

export type MediaRoute =
  | {kind: "video"; bvid: string; pageNumber: number}
  | {kind: "bangumi-episode"; episodeId: number}
  | {kind: "bangumi-season"; seasonId: number};
