import {describe, expect, it} from "vitest";
import {meanAbsoluteLumaDifference} from "../src/experiment/frameDifference";

describe("subtitle-region frame comparison", () => {
  it("returns zero for identical fingerprints", () => {
    expect(meanAbsoluteLumaDifference(
      new Uint8Array([0, 64, 128, 255]),
      new Uint8Array([0, 64, 128, 255])
    )).toBe(0);
  });

  it("returns a normalized mean absolute difference", () => {
    expect(meanAbsoluteLumaDifference(
      new Uint8Array([0, 0]),
      new Uint8Array([255, 127])
    )).toBeCloseTo(382 / 510, 6);
  });

  it("treats incompatible fingerprints as changed", () => {
    expect(meanAbsoluteLumaDifference(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(1);
  });
});
