import {DiagnosticError} from "./errors";
import {isRecord, numberValue, stringValue} from "./records";
import type {SubtitleTrackMetadata} from "../shared/types";

const textDecoder = new TextDecoder();

export interface ParsedSubtitleWebView {
  tracks: SubtitleTrackMetadata[];
  rawTrackCount: number;
}

/**
 * Decode the small subset of Bilibili's SubtitleView Protobuf response that we
 * need for diagnostics. Unknown fields are skipped so schema additions remain
 * forwards-compatible. Subtitle URLs are used only to establish usability and
 * are deliberately not returned or logged.
 */
export function parseSubtitleWebViewResponse(bytes: Uint8Array): ParsedSubtitleWebView {
  if (bytes.byteLength === 0) {
    throw new DiagnosticError("EMPTY_SUBTITLE_RESPONSE", "The subtitle endpoint returned an empty body.");
  }

  if (looksLikeJson(bytes)) return parseJsonResponse(bytes);

  const root = new ProtobufReader(bytes);
  let dataMessage: Uint8Array | undefined;

  while (!root.done) {
    const {field, wire} = root.readTag();
    if (field === 1 && wire === 2) dataMessage = root.readBytes();
    else root.skip(wire);
  }

  if (!dataMessage) {
    throw new DiagnosticError(
      "INVALID_SUBTITLE_PROTOBUF",
      "The subtitle endpoint response did not contain its expected data message."
    );
  }

  const data = new ProtobufReader(dataMessage);
  const rawTracks: DecodedTrack[] = [];
  while (!data.done) {
    const {field, wire} = data.readTag();
    if (field === 3 && wire === 2) rawTracks.push(decodeTrack(data.readBytes()));
    else data.skip(wire);
  }

  return {
    rawTrackCount: rawTracks.length,
    tracks: rawTracks.filter(isUsableTrack).map(toPublicMetadata)
  };
}

interface DecodedTrack {
  id?: bigint;
  idString?: string;
  languageCode?: string;
  languageLabel?: string;
  subtitleUrl?: string;
  label?: string;
  type?: number;
  aiType?: number;
}

function decodeTrack(bytes: Uint8Array): DecodedTrack {
  const reader = new ProtobufReader(bytes);
  const track: DecodedTrack = {};

  while (!reader.done) {
    const {field, wire} = reader.readTag();
    if (field === 1 && wire === 0) track.id = reader.readVarint();
    else if (field === 2 && wire === 2) track.idString = reader.readString();
    else if (field === 3 && wire === 2) track.languageCode = reader.readString();
    else if (field === 4 && wire === 2) track.languageLabel = reader.readString();
    else if (field === 5 && wire === 2) track.subtitleUrl = reader.readString();
    else if (field === 6 && wire === 0) track.type = Number(reader.readVarint());
    else if (field === 7 && wire === 0) track.aiType = Number(reader.readVarint());
    else if (field === 8 && wire === 2) track.label = reader.readString();
    else reader.skip(wire);
  }

  return track;
}

function isUsableTrack(track: DecodedTrack): boolean {
  return Boolean(
    track.subtitleUrl?.trim() &&
      (track.languageCode?.trim() || track.languageLabel?.trim() || track.label?.trim())
  );
}

function toPublicMetadata(track: DecodedTrack, index: number): SubtitleTrackMetadata {
  const languageCode = track.languageCode?.trim() ?? "";
  const languageLabel = track.languageLabel?.trim() || track.label?.trim() || "";
  const id = track.idString?.trim() || track.id?.toString() || `${languageCode || "track"}-${index}`;

  return {
    id,
    languageCode,
    languageLabel,
    isAiGenerated:
      languageCode.toLowerCase().startsWith("ai-") ||
      (track.aiType ?? track.type ?? 0) > 0 ||
      /\bai\b|自动生成/i.test(languageLabel)
  };
}

function looksLikeJson(bytes: Uint8Array): boolean {
  for (const value of bytes) {
    if (value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d) continue;
    return value === 0x7b || value === 0x5b;
  }
  return false;
}

function parseJsonResponse(bytes: Uint8Array): ParsedSubtitleWebView {
  let payload: unknown;
  try {
    payload = JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new DiagnosticError(
      "INVALID_SUBTITLE_JSON",
      "The subtitle endpoint returned malformed JSON instead of Protobuf."
    );
  }

  if (!isRecord(payload)) {
    throw new DiagnosticError("INVALID_SUBTITLE_JSON", "The subtitle endpoint JSON was not an object.");
  }

  const code = numberValue(payload.code);
  if (code !== undefined && code !== 0) {
    const message = stringValue(payload.message) || "Unknown Bilibili API error";
    throw new DiagnosticError("BILIBILI_SUBTITLE_ERROR", `Subtitle metadata failed with code ${code}: ${message}`);
  }

  throw new DiagnosticError(
    "UNEXPECTED_SUBTITLE_JSON",
    "The subtitle endpoint returned an unexpected JSON success response."
  );
}

class ProtobufReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  readTag(): {field: number; wire: number} {
    const tag = this.readVarint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field <= 0) this.fail("A Protobuf field number was invalid.");
    return {field, wire};
  }

  readVarint(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.done) this.fail("A Protobuf varint was truncated.");
      const byte = this.bytes[this.offset++];
      if (byte === undefined) this.fail("A Protobuf varint was truncated.");
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    this.fail("A Protobuf varint exceeded 10 bytes.");
  }

  readBytes(): Uint8Array {
    const length = this.readLength();
    const end = this.offset + length;
    if (end > this.bytes.length) this.fail("A length-delimited Protobuf field was truncated.");
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readString(): string {
    try {
      return textDecoder.decode(this.readBytes());
    } catch {
      this.fail("A Protobuf string was not valid UTF-8.");
    }
  }

  skip(wire: number): void {
    if (wire === 0) {
      this.readVarint();
      return;
    }
    if (wire === 1) {
      this.advance(8);
      return;
    }
    if (wire === 2) {
      this.advance(this.readLength());
      return;
    }
    if (wire === 5) {
      this.advance(4);
      return;
    }
    this.fail(`Unsupported Protobuf wire type ${wire}.`);
  }

  private readLength(): number {
    const value = this.readVarint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) this.fail("A Protobuf field length was too large.");
    return Number(value);
  }

  private advance(length: number): void {
    if (this.offset + length > this.bytes.length) this.fail("A Protobuf field was truncated.");
    this.offset += length;
  }

  private fail(message: string): never {
    throw new DiagnosticError("INVALID_SUBTITLE_PROTOBUF", message);
  }
}
