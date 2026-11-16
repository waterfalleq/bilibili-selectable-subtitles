import {DiagnosticError} from "./errors";
import {isRecord, positiveInteger, stringValue} from "./records";
import type {MediaIdentity, MediaRoute, PageHints, PageType} from "../shared/types";

const SUPPORTED_HOSTS = new Set(["bilibili.com", "www.bilibili.com"]);

export function parseMediaRoute(input: string): MediaRoute {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new DiagnosticError("INVALID_URL", "The current page URL is invalid.");
  }

  if (url.protocol !== "https:" || !SUPPORTED_HOSTS.has(url.hostname)) {
    throw new DiagnosticError("UNSUPPORTED_PAGE", "This is not a supported Bilibili page.");
  }

  const videoMatch = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)/i);
  if (videoMatch?.[1]) {
    const requestedPage = positiveInteger(url.searchParams.get("p")) ?? 1;
    return {kind: "video", bvid: videoMatch[1], pageNumber: requestedPage};
  }

  const episodeMatch = url.pathname.match(/^\/bangumi\/play\/ep(\d+)/i);
  if (episodeMatch?.[1]) {
    const episodeId = positiveInteger(episodeMatch[1]);
    if (episodeId) return {kind: "bangumi-episode", episodeId};
  }

  const seasonMatch = url.pathname.match(/^\/bangumi\/play\/ss(\d+)/i);
  if (seasonMatch?.[1]) {
    const seasonId = positiveInteger(seasonMatch[1]);
    if (seasonId) return {kind: "bangumi-season", seasonId};
  }

  throw new DiagnosticError("UNSUPPORTED_PAGE", "The current Bilibili route is not supported.");
}

export function resolveVideoIdentity(route: Extract<MediaRoute, {kind: "video"}>, payload: unknown): MediaIdentity {
  const data = readApiData(payload, "video metadata");
  const aid = requirePositiveInteger(data.aid, "aid");
  const bvid = requireString(stringValue(data.bvid) || route.bvid, "bvid");
  if (bvid.toLowerCase() !== route.bvid.toLowerCase()) {
    throw new DiagnosticError(
      "VIDEO_IDENTITY_MISMATCH",
      "Video metadata did not match the BV identifier in the current page URL."
    );
  }
  const rawPages = Array.isArray(data.pages) ? data.pages : [];
  const pages = rawPages.filter(isRecord);
  const isMultipart = pages.length > 1 || (positiveInteger(data.videos) ?? 1) > 1;

  let selectedPage: Record<string, unknown> | undefined;
  if (pages.length > 0) {
    selectedPage = pages.find((page) => positiveInteger(page.page) === route.pageNumber);
    if (!selectedPage) {
      throw new DiagnosticError(
        "PART_NOT_FOUND",
        `Part ${route.pageNumber} was not present in the video metadata response.`
      );
    }
  }

  const cid = requirePositiveInteger(selectedPage?.cid ?? data.cid, "cid");
  const pageType: PageType = isMultipart ? "multipart-video" : "regular-video";

  return {
    pageType,
    aid,
    bvid,
    cid,
    pageNumber: route.pageNumber,
    partTitle: stringValue(selectedPage?.part),
    resolutionSource: "route"
  };
}

export function resolveBangumiIdentity(
  route: Extract<MediaRoute, {kind: "bangumi-episode" | "bangumi-season"}>,
  payload: unknown,
  hints: PageHints = {}
): MediaIdentity {
  const result = readApiResult(payload, "Bangumi season metadata");
  const seasonId = requirePositiveInteger(result.season_id, "season_id");
  if (route.kind === "bangumi-season" && seasonId !== route.seasonId) {
    throw new DiagnosticError(
      "SEASON_IDENTITY_MISMATCH",
      "Season metadata did not match the season identifier in the current page URL."
    );
  }
  const episodes = collectEpisodes(result);

  let targetEpisodeId: number | undefined;
  let resolutionSource: MediaIdentity["resolutionSource"];

  if (route.kind === "bangumi-episode") {
    targetEpisodeId = route.episodeId;
    resolutionSource = "route";
  } else if (hints.activeEpisodeId && episodes.some((episode) => episode.id === hints.activeEpisodeId)) {
    targetEpisodeId = hints.activeEpisodeId;
    resolutionSource = "page-hint";
  } else {
    targetEpisodeId = episodes[0]?.id;
    resolutionSource = "season-default";
  }

  const episode = episodes.find((candidate) => candidate.id === targetEpisodeId);
  if (!episode) {
    throw new DiagnosticError(
      "EPISODE_NOT_FOUND",
      targetEpisodeId
        ? `Episode ${targetEpisodeId} was not present in the season metadata response.`
        : "No playable episode was present in the season metadata response."
    );
  }

  return {
    pageType: route.kind === "bangumi-episode" ? "bangumi-episode" : "bangumi-season",
    aid: requirePositiveInteger(episode.raw.aid, "aid"),
    bvid: requireString(episode.raw.bvid, "bvid"),
    cid: requirePositiveInteger(episode.raw.cid, "cid"),
    episodeId: episode.id,
    seasonId,
    episodeTitle: [stringValue(episode.raw.title), stringValue(episode.raw.long_title)]
      .filter(Boolean)
      .join(" — "),
    resolutionSource
  };
}

export function findActiveEpisodeIdInPageState(value: unknown): number | undefined {
  const visited = new Set<object>();

  function visit(candidate: unknown, depth: number): number | undefined {
    if (depth > 12 || (!isRecord(candidate) && !Array.isArray(candidate))) return undefined;
    if (visited.has(candidate)) return undefined;
    visited.add(candidate);

    if (isRecord(candidate)) {
      for (const key of ["episode_info", "epInfo", "ep_info"]) {
        const nested = candidate[key];
        if (!isRecord(nested)) continue;
        const id = positiveInteger(nested.ep_id ?? nested.episode_id ?? nested.id);
        if (id) return id;
      }

      for (const nested of Object.values(candidate)) {
        const id = visit(nested, depth + 1);
        if (id) return id;
      }
      return undefined;
    }

    for (const nested of candidate) {
      const id = visit(nested, depth + 1);
      if (id) return id;
    }
    return undefined;
  }

  return visit(value, 0);
}

function collectEpisodes(result: Record<string, unknown>): Array<{id: number; raw: Record<string, unknown>}> {
  const rawEpisodes: unknown[] = Array.isArray(result.episodes) ? [...result.episodes] : [];
  const sections = Array.isArray(result.section) ? result.section.filter(isRecord) : [];

  for (const section of sections) {
    if (Array.isArray(section.episodes)) rawEpisodes.push(...section.episodes);
  }

  const seen = new Set<number>();
  const episodes: Array<{id: number; raw: Record<string, unknown>}> = [];

  for (const raw of rawEpisodes) {
    if (!isRecord(raw)) continue;
    const id = positiveInteger(raw.ep_id ?? raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    episodes.push({id, raw});
  }

  return episodes;
}

function readApiData(payload: unknown, source: string): Record<string, unknown> {
  const root = requireSuccessfulRoot(payload, source);
  if (!isRecord(root.data)) {
    throw new DiagnosticError("INVALID_API_RESPONSE", `${source} did not include a data object.`);
  }
  return root.data;
}

function readApiResult(payload: unknown, source: string): Record<string, unknown> {
  const root = requireSuccessfulRoot(payload, source);
  if (!isRecord(root.result)) {
    throw new DiagnosticError("INVALID_API_RESPONSE", `${source} did not include a result object.`);
  }
  return root.result;
}

function requireSuccessfulRoot(payload: unknown, source: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new DiagnosticError("INVALID_API_RESPONSE", `${source} was not a JSON object.`);
  }

  const code = Number(payload.code);
  if (code !== 0) {
    const message = stringValue(payload.message) || "Unknown Bilibili API error";
    throw new DiagnosticError("BILIBILI_API_ERROR", `${source} failed with code ${code}: ${message}`);
  }

  return payload;
}

function requirePositiveInteger(value: unknown, field: string): number {
  const parsed = positiveInteger(value);
  if (!parsed) {
    throw new DiagnosticError("INVALID_API_RESPONSE", `Bilibili did not provide a valid ${field}.`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  const parsed = stringValue(value).trim();
  if (!parsed) {
    throw new DiagnosticError("INVALID_API_RESPONSE", `Bilibili did not provide a valid ${field}.`);
  }
  return parsed;
}
