import {describe, expect, it} from "vitest";
import {
  decideAutomaticOcrRuntime,
  normalizeAutomaticOcrPreference
} from "../src/experiment/ocrPreference";

describe("automatic OCR preference", () => {
  it("is disabled unless storage explicitly contains true", () => {
    expect(normalizeAutomaticOcrPreference(undefined)).toBe(false);
    expect(normalizeAutomaticOcrPreference("true")).toBe(false);
    expect(normalizeAutomaticOcrPreference(true)).toBe(true);
  });

  it("separates the saved preference from runtime readiness", () => {
    expect(decideAutomaticOcrRuntime({
      preferred: true,
      contextReady: false,
      nativeChineseActive: false,
      explicitOverride: false
    })).toBe("wait-context");
    expect(decideAutomaticOcrRuntime({
      preferred: true,
      contextReady: true,
      nativeChineseActive: false,
      explicitOverride: false
    })).toBe("run");
  });

  it("suppresses OCR for native Chinese captions unless explicitly overridden", () => {
    expect(decideAutomaticOcrRuntime({
      preferred: true,
      contextReady: true,
      nativeChineseActive: true,
      explicitOverride: false
    })).toBe("stop-native");
    expect(decideAutomaticOcrRuntime({
      preferred: true,
      contextReady: true,
      nativeChineseActive: true,
      explicitOverride: true
    })).toBe("run");
  });

  it("always respects an explicit saved Stop preference", () => {
    expect(decideAutomaticOcrRuntime({
      preferred: false,
      contextReady: true,
      nativeChineseActive: false,
      explicitOverride: true
    })).toBe("stop-preference");
  });
});
