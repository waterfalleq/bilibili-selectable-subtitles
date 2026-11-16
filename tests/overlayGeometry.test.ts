import {describe, expect, it} from "vitest";
import {
  clampRelativePosition,
  fitVideoContentRect,
  relativePointFromClient,
  resizeRelativeRectangleFromCorner
} from "../src/experiment/overlayGeometry";

describe("overlay geometry", () => {
  it("finds the displayed 16:9 video inside a wider letterboxed element", () => {
    expect(fitVideoContentRect(
      {left: 10, top: 20, width: 1000, height: 450},
      1920,
      1080,
      "contain"
    )).toEqual({left: 110, top: 20, width: 800, height: 450});
  });

  it("keeps non-contain video geometry unchanged", () => {
    expect(fitVideoContentRect(
      {left: 10, top: 20, width: 1000, height: 450},
      1920,
      1080,
      "fill"
    )).toEqual({left: 10, top: 20, width: 1000, height: 450});
  });

  it("converts a pointer to normalized coordinates and keeps the mask on-video", () => {
    expect(relativePointFromClient(
      100,
      10,
      {left: 100, top: 0, width: 800, height: 450},
      0.5,
      0.2
    )).toEqual({x: 0.25, y: 0.1});
    expect(clampRelativePosition({x: 0.95, y: 0.98}, 0.6, 0.2))
      .toEqual({x: 0.7, y: 0.9});
  });

  it("resizes a mask from one corner while keeping the opposite corner fixed", () => {
    const resized = resizeRelativeRectangleFromCorner(
      {centerX: 0.5, centerY: 0.7, width: 0.6, height: 0.2},
      "south-east",
      {x: 0.9, y: 0.9},
      {minimumWidth: 0.25, maximumWidth: 0.95, minimumHeight: 0.05, maximumHeight: 0.35}
    );
    expect(resized.centerX).toBeCloseTo(0.55);
    expect(resized.centerY).toBeCloseTo(0.75);
    expect(resized.width).toBeCloseTo(0.7);
    expect(resized.height).toBeCloseTo(0.3);
  });

  it("clamps mask resizing to configured size and video bounds", () => {
    const resized = resizeRelativeRectangleFromCorner(
      {centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.2},
      "north-west",
      {x: -1, y: -1},
      {minimumWidth: 0.25, maximumWidth: 0.6, minimumHeight: 0.05, maximumHeight: 0.3}
    );
    expect(resized.centerX).toBeCloseTo(0.45);
    expect(resized.centerY).toBeCloseTo(0.45);
    expect(resized.width).toBeCloseTo(0.6);
    expect(resized.height).toBeCloseTo(0.3);
  });
});
