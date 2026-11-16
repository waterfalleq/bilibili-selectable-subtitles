export const AUTOMATIC_OCR_PREFERENCE_STORAGE_KEY = "automaticOcrPreferredV1";

export type AutomaticOcrRuntimeDecision = "run" | "stop-preference" | "stop-native" | "wait-context";

export function normalizeAutomaticOcrPreference(value: unknown): boolean {
  return value === true;
}

export async function loadAutomaticOcrPreference(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTOMATIC_OCR_PREFERENCE_STORAGE_KEY);
  return normalizeAutomaticOcrPreference(stored[AUTOMATIC_OCR_PREFERENCE_STORAGE_KEY]);
}

export async function saveAutomaticOcrPreference(preferred: boolean): Promise<void> {
  await chrome.storage.local.set({[AUTOMATIC_OCR_PREFERENCE_STORAGE_KEY]: preferred});
}

export function decideAutomaticOcrRuntime(input: {
  preferred: boolean;
  contextReady: boolean;
  nativeChineseActive: boolean;
  explicitOverride: boolean;
}): AutomaticOcrRuntimeDecision {
  if (!input.preferred) return "stop-preference";
  if (input.explicitOverride) return "run";
  if (!input.contextReady) return "wait-context";
  return input.nativeChineseActive ? "stop-native" : "run";
}
