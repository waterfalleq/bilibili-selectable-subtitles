import {DiagnosticError} from "./errors";
import {isRecord, numberValue, stringValue} from "./records";
import type {
  DiscoveryStatus,
  MediaIdentity,
  SubtitleTrackMetadata
} from "../shared/types";

export interface ParsedTrackDiscovery {
  status: DiscoveryStatus;
  needLoginSubtitle: boolean;
  totalTrackCount: number;
  chineseTracks: SubtitleTrackMetadata[];
  note: string;
}

export function parseTrackDiscovery(identity: MediaIdentity, payload: unknown): ParsedTrackDiscovery {
  if (!isRecord(payload)) {
    throw new DiagnosticError("INVALID_PLAYER_RESPONSE", "Player metadata was not a JSON object.");
  }

  const code = Number(payload.code);
  if (code !== 0) {
    const message = stringValue(payload.message) || "Unknown Bilibili API error";
    throw new DiagnosticError("BILIBILI_PLAYER_ERROR", `Player metadata failed with code ${code}: ${message}`);
  }

  if (!isRecord(payload.data)) {
    throw new DiagnosticError("INVALID_PLAYER_RESPONSE", "Player metadata did not include a data object.");
  }

  validateResponseIdentity(identity, payload.data);

  const needLoginSubtitle = payload.data.need_login_subtitle === true;
  const subtitle = isRecord(payload.data.subtitle) ? payload.data.subtitle : undefined;
  const rawTracks = subtitle && Array.isArray(subtitle.subtitles) ? subtitle.subtitles : [];
  const normalizedTracks = rawTracks.filter(isRecord).map(normalizeTrack);
  const chineseTracks = normalizedTracks.filter(isChineseTrack);

  if (chineseTracks.length > 0) {
    return {
      status: "tracks-found",
      needLoginSubtitle,
      totalTrackCount: normalizedTracks.length,
      chineseTracks,
      note: `${chineseTracks.length} Chinese subtitle track(s) were reported by the player API.`
    };
  }

  if (normalizedTracks.length > 0) {
    return {
      status: "no-chinese-tracks",
      needLoginSubtitle,
      totalTrackCount: normalizedTracks.length,
      chineseTracks,
      note: "The player API returned subtitle tracks, but none were identified as Chinese."
    };
  }

  if (needLoginSubtitle) {
    return {
      status: "login-required",
      needLoginSubtitle,
      totalTrackCount: 0,
      chineseTracks,
      note: "The API returned no tracks and explicitly reported that subtitle access requires login."
    };
  }

  return {
    status: "no-tracks-reported",
    needLoginSubtitle,
    totalTrackCount: 0,
    chineseTracks,
    note: "The API reported no tracks. This does not prove that the video has no subtitles."
  };
}

export function isChineseTrack(track: SubtitleTrackMetadata): boolean {
  const code = track.languageCode.trim().toLowerCase().replaceAll("_", "-");
  const segments = code.split("-").filter(Boolean);
  const label = track.languageLabel.trim();

  return (
    segments.includes("zh") ||
    code === "chi" ||
    code === "zho" ||
    /中文|简体|繁體|繁体|汉语|漢語|chinese/i.test(label)
  );
}

function normalizeTrack(track: Record<string, unknown>, index: number): SubtitleTrackMetadata {
  const languageCode = stringValue(track.lan ?? track.language ?? track.lang).trim();
  const languageLabel = stringValue(track.lan_doc ?? track.language_doc ?? track.label).trim();
  const id = String(track.id_str ?? track.id ?? `${languageCode || "track"}-${index}`);
  const aiType = numberValue(track.ai_type) ?? numberValue(track.type) ?? 0;

  return {
    id,
    languageCode,
    languageLabel,
    isAiGenerated: aiType > 0 || languageCode.toLowerCase().startsWith("ai-")
  };
}

function validateResponseIdentity(identity: MediaIdentity, data: Record<string, unknown>): void {
  const responseAid = numberValue(data.aid);
  const responseCid = numberValue(data.cid);
  const responseBvid = stringValue(data.bvid);

  const mismatches: string[] = [];
  if (responseAid !== undefined && responseAid !== identity.aid) mismatches.push("aid");
  if (responseCid !== undefined && responseCid !== identity.cid) mismatches.push("cid");
  if (responseBvid && responseBvid.toLowerCase() !== identity.bvid.toLowerCase()) mismatches.push("bvid");

  if (mismatches.length > 0) {
    throw new DiagnosticError(
      "PLAYER_IDENTITY_MISMATCH",
      `Player metadata did not match the requested media identity (${mismatches.join(", ")}).`
    );
  }
}
