const NATIVE_TEXT_SELECTORS = [
  ".bpx-player-subtitle-panel-text",
  ".bpx-player-subtitle-text",
  ".bilibili-player-video-subtitle",
  '[class*="bpx-player-subtitle-panel-text"]'
].join(",");

const ACTIVE_CONTROL_SELECTORS = [
  '.bpx-player-ctrl-subtitle[aria-pressed="true"]',
  '.bpx-player-ctrl-subtitle[aria-checked="true"]',
  '.bpx-player-ctrl-subtitle[data-state="active"]',
  '.bpx-player-ctrl-subtitle[data-state="on"]',
  ".bpx-player-ctrl-subtitle.bpx-state-active",
  ".bpx-player-ctrl-subtitle.active"
].join(",");

export function containsChineseText(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

/**
 * Conservative DOM check for Bilibili's own active Chinese captions. A visible
 * Chinese cue is definitive. An explicitly-active subtitle control is accepted
 * only when discovery reported at least one usable Chinese native track.
 */
export function detectActiveNativeChineseSubtitles(
  chineseTrackAvailable: boolean,
  documentValue: Document = document
): boolean {
  const cueElements = documentValue.querySelectorAll<HTMLElement>(NATIVE_TEXT_SELECTORS);
  for (const element of cueElements) {
    if (isRendered(element) && containsChineseText(element.textContent ?? "")) return true;
  }

  return chineseTrackAvailable && documentValue.querySelector(ACTIVE_CONTROL_SELECTORS) !== null;
}

function isRendered(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
