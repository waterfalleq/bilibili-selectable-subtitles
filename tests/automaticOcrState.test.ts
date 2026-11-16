import {describe, expect, it} from "vitest";
import {OcrGeneration, SubtitleStabilizer} from "../src/experiment/automaticOcrState";

describe("automatic OCR subtitle stabilization", () => {
  it("accepts a strong multi-character result immediately and deduplicates it", () => {
    const state = new SubtitleStabilizer();
    expect(state.observe({text: "真的吗", confidence: 96})).toEqual({type: "display", text: "真的吗"});
    expect(state.observe({text: "真的吗", confidence: 97})).toEqual({type: "none", reason: "unchanged"});
    expect(state.getConfirmedText()).toBe("真的吗");
  });

  it("requires repeated evidence for lower-confidence candidates", () => {
    const state = new SubtitleStabilizer();
    expect(state.observe({text: "师傅", confidence: 70})).toEqual({type: "none", reason: "candidate"});
    expect(state.needsFollowUp()).toBe(true);
    expect(state.observe({text: "师傅", confidence: 72})).toEqual({type: "display", text: "师傅"});
  });

  it("ignores isolated low-confidence Chinese false positives", () => {
    const state = new SubtitleStabilizer();
    expect(state.observe({text: "可", confidence: 9.6})).toEqual({type: "none", reason: "inconclusive"});
    expect(state.getConfirmedText()).toBe("");
  });

  it("preserves a subtitle across one blank and clears it after two", () => {
    const state = new SubtitleStabilizer();
    state.observe({text: "救救命", confidence: 97});
    expect(state.observe({text: "", confidence: 0})).toEqual({type: "none", reason: "possible-clear"});
    expect(state.getConfirmedText()).toBe("救救命");
    expect(state.observe({text: "", confidence: 0})).toEqual({type: "clear"});
    expect(state.getConfirmedText()).toBe("");
  });

  it("does not clear on an OCR failure represented as inconclusive text", () => {
    const state = new SubtitleStabilizer();
    state.observe({text: "快快去救", confidence: 96});
    expect(state.observe({text: "错误", confidence: 20})).toEqual({type: "none", reason: "inconclusive"});
    expect(state.getConfirmedText()).toBe("快快去救");
  });

  it("requires confirmation before replacing a subtitle with a minor OCR variant", () => {
    const state = new SubtitleStabilizer();
    state.observe({text: "以后还要带你们来这边享福嘞", confidence: 98});
    expect(state.observe({text: "以后还要带你门来这边享福嘞", confidence: 98}))
      .toEqual({type: "none", reason: "candidate"});
    expect(state.getConfirmedText()).toBe("以后还要带你们来这边享福嘞");
    expect(state.observe({text: "以后还要带你们来这边享福嘞", confidence: 98}))
      .toEqual({type: "none", reason: "unchanged"});
  });
});

describe("automatic OCR stale-result generation", () => {
  it("rejects results captured before seek or navigation invalidation", () => {
    const generation = new OcrGeneration();
    const first = generation.capture();
    expect(generation.isCurrent(first)).toBe(true);
    generation.invalidate();
    expect(generation.isCurrent(first)).toBe(false);
    expect(generation.isCurrent(generation.capture())).toBe(true);
  });
});
