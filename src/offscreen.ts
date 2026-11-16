import {isRecord} from "./core/records";
import {recognizeChineseSubtitleVariants} from "./experiment/localOcr";
import {recognizePaddleChineseSubtitle} from "./experiment/paddleOcr";
import type {OcrExperimentResponse, OcrOffscreenRequest} from "./shared/types";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenRequest(message)) return false;

  if (message.mode === "automatic") {
    void recognizePaddleChineseSubtitle(message.imageDataUrl)
      .then((measurement) => sendResponse({ok: true, measurement}))
      .catch((error: unknown) => sendResponse({
        ok: false,
        error: {
          code: "LOCAL_OCR_ERROR",
          message: error instanceof Error ? error.message : "Local OCR failed."
        }
      }));
    return true;
  }

  void Promise.allSettled([
    recognizePaddleChineseSubtitle(message.imageDataUrl),
    recognizeChineseSubtitleVariants(message.imageDataUrl)
  ])
    .then((settled) => {
      const results = settled.flatMap((result) =>
        result.status === "fulfilled"
          ? Array.isArray(result.value) ? result.value : [result.value]
          : []
      );
      const engineErrors = settled.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : "An OCR engine failed."]
          : []
      );
      if (results.length === 0) {
        throw new Error(engineErrors.join("; ") || "All OCR engines failed.");
      }
      const response: OcrExperimentResponse = {ok: true, results, engineErrors};
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const response: OcrExperimentResponse = {
        ok: false,
        error: {
          code: "LOCAL_OCR_ERROR",
          message: error instanceof Error ? error.message : "Local OCR failed."
        }
      };
      sendResponse(response);
    });

  return true;
});

function isOffscreenRequest(value: unknown): value is OcrOffscreenRequest {
  return (
    isRecord(value) &&
    value.type === "BILIBILI_SUBTITLE_OCR_OFFSCREEN_RUN" &&
    typeof value.imageDataUrl === "string" &&
    value.imageDataUrl.startsWith("data:image/png;base64,") &&
    (value.mode === "experiment" || value.mode === "automatic")
  );
}
