import {describe, expect, it} from "vitest";
import {selectChineseOverlayText} from "../src/experiment/manualOverlay";
import type {OcrEngineMeasurement} from "../src/shared/types";

function measurement(model: string, text: string): OcrEngineMeasurement {
  return {
    model,
    text,
    confidence: 95,
    initializationMs: 1,
    inferenceMs: 2,
    totalMs: 3
  };
}

describe("manual OCR overlay text selection", () => {
  it("uses the PP-OCR result and removes detected English translation lines", () => {
    expect(selectChineseOverlayText([
      measurement("Tesseract.js chi_sim", "错误"),
      measurement("PP-OCRv5 Chinese det+rec", "是《汉化日记》对吧\nis God Troubles Me, right?")
    ])).toBe("是《汉化日记》对吧");
  });

  it("preserves multiple Chinese lines and rejects non-Chinese false positives", () => {
    expect(selectChineseOverlayText([
      measurement("PP-OCRv5 Chinese det+rec", "第一行\n第二行")
    ])).toBe("第一行\n第二行");
    expect(selectChineseOverlayText([
      measurement("PP-OCRv5 Chinese det+rec", "1")
    ])).toBe("");
  });

  it("does not fall back to a different OCR engine", () => {
    expect(selectChineseOverlayText([
      measurement("Tesseract.js chi_sim", "不应显示")
    ])).toBe("");
  });
});
