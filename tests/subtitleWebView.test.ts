import {describe, expect, it} from "vitest";
import {parseSubtitleWebViewResponse} from "../src/core/subtitleWebView";

const encoder = new TextEncoder();

describe("parseSubtitleWebViewResponse", () => {
  it("decodes usable track metadata without exposing the signed subtitle URL", () => {
    const track = message(
      varintField(1, 1234567890123456789n),
      stringField(2, "1234567890123456789"),
      stringField(3, "zh-Hans"),
      stringField(4, "中文（简体）"),
      stringField(5, "//aisubtitle.hdslb.com/private.bcc?auth_key=secret"),
      stringField(8, "人工字幕")
    );
    const data = message(bytesField(3, track));
    const parsed = parseSubtitleWebViewResponse(message(bytesField(1, data)));

    expect(parsed).toEqual({
      rawTrackCount: 1,
      tracks: [
        {
          id: "1234567890123456789",
          languageCode: "zh-Hans",
          languageLabel: "中文（简体）",
          isAiGenerated: false
        }
      ]
    });
    expect(JSON.stringify(parsed)).not.toContain("auth_key");
  });

  it("accepts the endpoint's valid empty Protobuf response", () => {
    expect(parseSubtitleWebViewResponse(Uint8Array.from([0x0a, 0x00]))).toEqual({
      rawTrackCount: 0,
      tracks: []
    });
  });

  it("counts but excludes unusable tracks without a subtitle body URL", () => {
    const track = message(stringField(3, "ai-zh"), stringField(4, "中文（AI）"));
    const data = message(bytesField(3, track));
    expect(parseSubtitleWebViewResponse(message(bytesField(1, data)))).toEqual({
      rawTrackCount: 1,
      tracks: []
    });
  });

  it("reports JSON API errors safely", () => {
    const bytes = encoder.encode(JSON.stringify({code: -400, message: "请求错误"}));
    expect(() => parseSubtitleWebViewResponse(bytes)).toThrowError(/code -400/i);
  });

  it("rejects truncated Protobuf rather than returning a false empty result", () => {
    expect(() => parseSubtitleWebViewResponse(Uint8Array.from([0x0a, 0x05, 0x1a]))).toThrowError(
      /truncated/i
    );
  });
});

function message(...fields: Uint8Array[]): Uint8Array {
  const length = fields.reduce((total, field) => total + field.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const field of fields) {
    output.set(field, offset);
    offset += field.length;
  }
  return output;
}

function stringField(field: number, value: string): Uint8Array {
  return bytesField(field, encoder.encode(value));
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return message(encodeVarint(BigInt((field << 3) | 2)), encodeVarint(BigInt(value.length)), value);
}

function varintField(field: number, value: bigint): Uint8Array {
  return message(encodeVarint(BigInt(field << 3)), encodeVarint(value));
}

function encodeVarint(input: bigint): Uint8Array {
  const output: number[] = [];
  let value = input;
  do {
    const byte = Number(value & 0x7fn);
    value >>= 7n;
    output.push(value > 0n ? byte | 0x80 : byte);
  } while (value > 0n);
  return Uint8Array.from(output);
}
