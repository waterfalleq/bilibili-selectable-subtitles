export const OVERLAY_SETTINGS_STORAGE_KEY = "subtitleOverlayAppearanceV1";

export interface OverlaySettings {
  positionX: number;
  positionY: number;
  fontSizePx: number;
  maskPositionX: number;
  maskPositionY: number;
  maskWidthRatio: number;
  maskHeightRatio: number;
  backgroundOpacity: number;
  paddingPx: number;
  overlayVisible: boolean;
}

export const DEFAULT_OVERLAY_SETTINGS: Readonly<OverlaySettings> = {
  positionX: 0.5,
  positionY: 0.84,
  fontSizePx: 30,
  maskPositionX: 0.5,
  maskPositionY: 0.84,
  maskWidthRatio: 0.7,
  maskHeightRatio: 0.13,
  backgroundOpacity: 0.72,
  paddingPx: 10,
  overlayVisible: true
};

export function normalizeOverlaySettings(value: unknown): OverlaySettings {
  const input = isRecord(value) ? value : {};
  const positionX = boundedNumber(input.positionX, DEFAULT_OVERLAY_SETTINGS.positionX, 0, 1);
  const positionY = boundedNumber(input.positionY, DEFAULT_OVERLAY_SETTINGS.positionY, 0, 1);
  const maskWidthRatio = boundedNumber(input.maskWidthRatio, DEFAULT_OVERLAY_SETTINGS.maskWidthRatio, 0.25, 0.95);
  const maskHeightRatio = boundedNumber(input.maskHeightRatio, DEFAULT_OVERLAY_SETTINGS.maskHeightRatio, 0.05, 0.35);
  // Migrate the previous text-relative mask offsets when absolute positions are absent.
  const legacyMaskX = positionX + boundedNumber(input.maskOffsetXRatio, 0, -0.25, 0.25);
  const legacyMaskY = positionY + boundedNumber(input.maskOffsetYRatio, 0, -0.25, 0.25);
  const maskPositionX = clampToMaskBounds(
    boundedNumber(input.maskPositionX, legacyMaskX, 0, 1),
    maskWidthRatio
  );
  const maskPositionY = clampToMaskBounds(
    boundedNumber(input.maskPositionY, legacyMaskY, 0, 1),
    maskHeightRatio
  );
  return {
    positionX,
    positionY,
    fontSizePx: boundedNumber(input.fontSizePx, DEFAULT_OVERLAY_SETTINGS.fontSizePx, 16, 52),
    maskPositionX,
    maskPositionY,
    maskWidthRatio,
    maskHeightRatio,
    backgroundOpacity: boundedNumber(input.backgroundOpacity, DEFAULT_OVERLAY_SETTINGS.backgroundOpacity, 0, 0.95),
    paddingPx: boundedNumber(input.paddingPx, DEFAULT_OVERLAY_SETTINGS.paddingPx, 0, 32),
    overlayVisible: typeof input.overlayVisible === "boolean"
      ? input.overlayVisible
      : DEFAULT_OVERLAY_SETTINGS.overlayVisible
  };
}

export function mergeOverlaySettings(
  current: OverlaySettings,
  patch: Partial<OverlaySettings>
): OverlaySettings {
  return normalizeOverlaySettings({...current, ...patch});
}

export async function loadOverlaySettings(): Promise<OverlaySettings> {
  const result = await chrome.storage.local.get(OVERLAY_SETTINGS_STORAGE_KEY);
  return normalizeOverlaySettings(result[OVERLAY_SETTINGS_STORAGE_KEY]);
}

export async function saveOverlaySettings(settings: OverlaySettings): Promise<void> {
  await chrome.storage.local.set({[OVERLAY_SETTINGS_STORAGE_KEY]: settings});
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function clampToMaskBounds(value: number, size: number): number {
  return Math.min(1 - size / 2, Math.max(size / 2, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
