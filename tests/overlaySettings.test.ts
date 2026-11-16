import {describe, expect, it} from "vitest";
import {
  DEFAULT_OVERLAY_SETTINGS,
  mergeOverlaySettings,
  normalizeOverlaySettings
} from "../src/experiment/overlaySettings";

describe("overlay settings", () => {
  it("uses defaults for missing or malformed storage", () => {
    expect(normalizeOverlaySettings(null)).toEqual(DEFAULT_OVERLAY_SETTINGS);
    expect(normalizeOverlaySettings({fontSizePx: "large"})).toEqual(DEFAULT_OVERLAY_SETTINGS);
  });

  it("clamps persisted values to safe UI ranges", () => {
    expect(normalizeOverlaySettings({
      positionX: -3,
      positionY: 4,
      fontSizePx: 200,
      maskPositionX: -2,
      maskPositionY: 3,
      maskWidthRatio: 0.01,
      maskHeightRatio: 0.8,
      backgroundOpacity: 2,
      paddingPx: -5,
      overlayVisible: false
    })).toEqual({
      positionX: 0,
      positionY: 1,
      fontSizePx: 52,
      maskPositionX: 0.125,
      maskPositionY: 0.825,
      maskWidthRatio: 0.25,
      maskHeightRatio: 0.35,
      backgroundOpacity: 0.95,
      paddingPx: 0,
      overlayVisible: false
    });
  });

  it("migrates legacy mask offsets to an independent absolute position", () => {
    const settings = normalizeOverlaySettings({
      positionX: 0.4,
      positionY: 0.7,
      maskOffsetXRatio: 0.1,
      maskOffsetYRatio: -0.05
    });
    expect(settings.positionX).toBeCloseTo(0.4);
    expect(settings.positionY).toBeCloseTo(0.7);
    expect(settings.maskPositionX).toBeCloseTo(0.5);
    expect(settings.maskPositionY).toBeCloseTo(0.65);
  });

  it("merges one appearance change without losing position", () => {
    expect(mergeOverlaySettings({...DEFAULT_OVERLAY_SETTINGS, positionX: 0.4}, {fontSizePx: 36}))
      .toMatchObject({positionX: 0.4, fontSizePx: 36});
  });
});
