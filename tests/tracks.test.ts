import {describe, expect, it} from "vitest";
import {isChineseTrack, parseTrackDiscovery} from "../src/core/tracks";
import type {MediaIdentity, SubtitleTrackMetadata} from "../src/shared/types";

const identity: MediaIdentity = {
  pageType: "regular-video",
  aid: 100,
  bvid: "BV1234567890",
  cid: 200,
  pageNumber: 1,
  resolutionSource: "route"
};

describe("isChineseTrack", () => {
  it.each([
    ["zh-CN", "中文"],
    ["ai-zh", "中文（AI）"],
    ["zh_Hant", "繁體中文"],
    ["", "Chinese (Simplified)"]
  ])("accepts Chinese track %s / %s", (languageCode, languageLabel) => {
    const track: SubtitleTrackMetadata = {
      id: "1",
      languageCode,
      languageLabel,
      isAiGenerated: false
    };
    expect(isChineseTrack(track)).toBe(true);
  });

  it("does not accept unrelated languages", () => {
    expect(
      isChineseTrack({
        id: "1",
        languageCode: "ja-JP",
        languageLabel: "日本語",
        isAiGenerated: false
      })
    ).toBe(false);
  });
});

describe("parseTrackDiscovery", () => {
  it("returns sanitized metadata for Chinese tracks", () => {
    const result = parseTrackDiscovery(identity, {
      code: 0,
      data: {
        aid: 100,
        bvid: "BV1234567890",
        cid: 200,
        need_login_subtitle: false,
        subtitle: {
          subtitles: [
            {
              id: 7,
              lan: "ai-zh",
              lan_doc: "中文（AI）",
              ai_type: 1,
              subtitle_url: "//example.invalid/private?auth_key=secret"
            },
            {id: 8, lan: "en-US", lan_doc: "English"}
          ]
        }
      }
    });

    expect(result).toEqual({
      status: "tracks-found",
      needLoginSubtitle: false,
      totalTrackCount: 2,
      chineseTracks: [
        {id: "7", languageCode: "ai-zh", languageLabel: "中文（AI）", isAiGenerated: true}
      ],
      note: "1 Chinese subtitle track(s) were reported by the player API."
    });
    expect(JSON.stringify(result)).not.toContain("auth_key");
  });

  it("does not misclassify an empty login-gated response", () => {
    const result = parseTrackDiscovery(identity, {
      code: 0,
      data: {
        aid: 100,
        bvid: "BV1234567890",
        cid: 200,
        need_login_subtitle: true,
        subtitle: {subtitles: []}
      }
    });

    expect(result.status).toBe("login-required");
    expect(result.note).toMatch(/requires login/i);
  });

  it("uses an explicitly uncertain status for other empty responses", () => {
    const result = parseTrackDiscovery(identity, {
      code: 0,
      data: {
        aid: 100,
        bvid: "BV1234567890",
        cid: 200,
        need_login_subtitle: false,
        subtitle: {subtitles: []}
      }
    });

    expect(result.status).toBe("no-tracks-reported");
    expect(result.note).toMatch(/does not prove/i);
  });

  it("rejects metadata for a different video", () => {
    expect(() =>
      parseTrackDiscovery(identity, {
        code: 0,
        data: {
          aid: 999,
          bvid: "BV9999999999",
          cid: 888,
          subtitle: {subtitles: []}
        }
      })
    ).toThrowError(/did not match/i);
  });
});
