import {describe, expect, it} from "vitest";
import {containsChineseText} from "../src/experiment/nativeSubtitles";

describe("native subtitle detection", () => {
  it("distinguishes Chinese cues from other player text", () => {
    expect(containsChineseText("今天去哪里？")).toBe(true);
    expect(containsChineseText("Where are we going?")).toBe(false);
    expect(containsChineseText("")).toBe(false);
  });
});
