import type {OcrEngineMeasurement} from "../shared/types";
import {findActiveVideo} from "./frameCapture";
import {
  clampRelativePosition,
  fitVideoContentRect,
  relativePointFromClient,
  resizeRelativeRectangleFromCorner,
  type ResizeCorner
} from "./overlayGeometry";
import {
  DEFAULT_OVERLAY_SETTINGS,
  loadOverlaySettings,
  mergeOverlaySettings,
  normalizeOverlaySettings,
  saveOverlaySettings,
  type OverlaySettings
} from "./overlaySettings";

const OVERLAY_ID = "bso-manual-subtitle-overlay";
const SETTINGS_SAVE_DELAY_MS = 150;

export type OverlayEditingMode = "none" | "adjust";

export interface ManualSubtitleOverlay {
  root: HTMLDivElement;
  mask: HTMLDivElement;
  text: HTMLSpanElement;
  resizeHandles: HTMLButtonElement[];
  adjustmentToolbar: HTMLDivElement;
  setText: (value: string) => void;
  clear: () => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  syncContainer: () => void;
  syncGeometry: () => void;
  getSettings: () => OverlaySettings;
  updateSettings: (patch: Partial<OverlaySettings>, persist?: boolean) => void;
  resetSettings: () => void;
  subscribeSettings: (listener: (settings: OverlaySettings) => void) => () => void;
  setEditingMode: (mode: OverlayEditingMode) => void;
  getEditingMode: () => OverlayEditingMode;
  subscribeEditingMode: (listener: (mode: OverlayEditingMode) => void) => () => void;
}

export function selectChineseOverlayText(results: OcrEngineMeasurement[]): string {
  const paddle = results.find((measurement) => measurement.model.startsWith("PP-OCRv5"));
  if (!paddle) return "";
  return paddle.text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, ""))
    .filter((line) => /\p{Script=Han}/u.test(line))
    .join("\n");
}

export function createManualSubtitleOverlay(): ManualSubtitleOverlay {
  document.getElementById(OVERLAY_ID)?.remove();

  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.hidden = true;
  root.setAttribute("role", "note");
  root.setAttribute("aria-label", "Recognized Chinese subtitle");
  root.lang = "zh-CN";

  const mask = document.createElement("div");
  mask.className = "bso-subtitle-mask";
  mask.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "bso-manual-subtitle-text";
  text.tabIndex = 0;

  const resizeHandles = ([
    "north-west",
    "north-east",
    "south-west",
    "south-east"
  ] as ResizeCorner[]).map((corner) => {
    const resizeHandle = document.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "bso-mask-resize-handle";
    resizeHandle.dataset.corner = corner;
    resizeHandle.title = `Resize mask from ${corner}`;
    resizeHandle.setAttribute("aria-label", `Resize subtitle mask from ${corner}`);
    return resizeHandle;
  });

  const adjustmentToolbar = document.createElement("div");
  adjustmentToolbar.className = "bso-adjustment-toolbar";
  adjustmentToolbar.setAttribute("role", "status");
  const adjustmentCopy = document.createElement("div");
  const adjustmentTitle = document.createElement("strong");
  adjustmentTitle.textContent = "✥  Adjust subtitles";
  const adjustmentHint = document.createElement("span");
  adjustmentHint.textContent = "Drag text or mask · Drag corners to resize · Esc to exit";
  adjustmentCopy.append(adjustmentTitle, adjustmentHint);
  const doneButton = document.createElement("button");
  doneButton.type = "button";
  doneButton.className = "bso-adjustment-done";
  doneButton.textContent = "Done";
  adjustmentToolbar.append(adjustmentCopy, doneButton);

  root.append(mask, text, ...resizeHandles, adjustmentToolbar);

  let currentText = "";
  let editingMode: OverlayEditingMode = "none";
  let settings = normalizeOverlaySettings(DEFAULT_OVERLAY_SETTINGS);
  let settingsRevision = 0;
  let saveTimer: number | undefined;
  let observedVideo: HTMLVideoElement | undefined;
  let observedContainer: HTMLElement | undefined;
  const settingsListeners = new Set<(value: OverlaySettings) => void>();
  const editingModeListeners = new Set<(value: OverlayEditingMode) => void>();

  const updateVisibility = (): void => {
    root.hidden = !settings.overlayVisible || (currentText.length === 0 && editingMode === "none");
  };

  const notifySettings = (): void => {
    const snapshot = {...settings};
    for (const listener of settingsListeners) listener(snapshot);
  };

  const scheduleSave = (): void => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void saveOverlaySettings(settings).catch(() => undefined);
    }, SETTINGS_SAVE_DELAY_MS);
  };

  const applyAppearance = (): void => {
    root.style.setProperty("--bso-font-size", `${settings.fontSizePx}px`);
    root.style.setProperty("--bso-mask-opacity", String(settings.backgroundOpacity));
    root.style.setProperty("--bso-text-padding", `${settings.paddingPx}px`);
  };

  const syncGeometry = (): void => {
    const video = findActiveVideo();
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const videoRect = fitVideoContentRect(
      video.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
      getComputedStyle(video).objectFit
    );
    const textPosition = clampRelativePosition(
      {x: settings.positionX, y: settings.positionY},
      0.04,
      0.04
    );
    const maskPosition = clampRelativePosition(
      {x: settings.maskPositionX, y: settings.maskPositionY},
      settings.maskWidthRatio,
      settings.maskHeightRatio
    );
    root.style.left = `${videoRect.left}px`;
    root.style.top = `${videoRect.top}px`;
    root.style.width = `${videoRect.width}px`;
    root.style.height = `${videoRect.height}px`;
    text.style.left = `${textPosition.x * 100}%`;
    text.style.top = `${textPosition.y * 100}%`;
    mask.style.left = `${maskPosition.x * 100}%`;
    mask.style.top = `${maskPosition.y * 100}%`;
    mask.style.width = `${settings.maskWidthRatio * 100}%`;
    mask.style.height = `${settings.maskHeightRatio * 100}%`;
    for (const resizeHandle of resizeHandles) {
      const corner = resizeHandle.dataset.corner as ResizeCorner;
      resizeHandle.style.left = `${(maskPosition.x + (corner.endsWith("east") ? 1 : -1) * settings.maskWidthRatio / 2) * 100}%`;
      resizeHandle.style.top = `${(maskPosition.y + (corner.startsWith("south") ? 1 : -1) * settings.maskHeightRatio / 2) * 100}%`;
    }
  };

  const resizeObserver = new ResizeObserver(syncGeometry);

  const syncContainer = (): void => {
    const video = findActiveVideo();
    const fullscreen = document.fullscreenElement;
    const container = fullscreen instanceof HTMLElement && (!video || fullscreen.contains(video))
      ? fullscreen
      : document.documentElement;
    if (root.parentElement !== container) container.append(root);

    if (video !== observedVideo || container !== observedContainer) {
      resizeObserver.disconnect();
      if (video) resizeObserver.observe(video);
      resizeObserver.observe(container);
      observedVideo = video;
      observedContainer = container;
    }
    applyAppearance();
    syncGeometry();
  };

  const updateSettings = (patch: Partial<OverlaySettings>, persist = true): void => {
    settingsRevision += 1;
    settings = mergeOverlaySettings(settings, patch);
    applyAppearance();
    syncGeometry();
    updateVisibility();
    notifySettings();
    if (persist) scheduleSave();
  };

  const setEditingMode = (mode: OverlayEditingMode): void => {
    editingMode = mode;
    root.dataset.editMode = mode;
    updateVisibility();
    syncContainer();
    for (const listener of editingModeListeners) listener(mode);
  };

  const overlay: ManualSubtitleOverlay = {
    root,
    mask,
    text,
    resizeHandles,
    adjustmentToolbar,
    setText(value) {
      if (currentText !== value) {
        currentText = value;
        // OCR is untrusted text. Never parse it as markup.
        text.textContent = value;
      }
      updateVisibility();
      syncContainer();
    },
    clear() {
      if (currentText !== "") {
        currentText = "";
        text.textContent = "";
      }
      updateVisibility();
    },
    setEnabled(value) {
      if (!value && editingMode !== "none") setEditingMode("none");
      updateSettings({overlayVisible: value});
      syncContainer();
    },
    isEnabled: () => settings.overlayVisible,
    syncContainer,
    syncGeometry,
    getSettings: () => ({...settings}),
    updateSettings,
    resetSettings() {
      updateSettings(DEFAULT_OVERLAY_SETTINGS);
    },
    subscribeSettings(listener) {
      settingsListeners.add(listener);
      listener({...settings});
      return () => settingsListeners.delete(listener);
    },
    setEditingMode,
    getEditingMode: () => editingMode,
    subscribeEditingMode(listener) {
      editingModeListeners.add(listener);
      listener(editingMode);
      return () => editingModeListeners.delete(listener);
    }
  };

  doneButton.addEventListener("click", () => setEditingMode("none"));

  const videoPoint = (event: PointerEvent, width = 0, height = 0) => {
    const video = findActiveVideo();
    if (!video) return undefined;
    const videoRect = fitVideoContentRect(
      video.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
      getComputedStyle(video).objectFit
    );
    return relativePointFromClient(
      event.clientX,
      event.clientY,
      videoRect,
      width,
      height
    );
  };

  const bindDrag = (
    dragHandle: HTMLElement,
    onMove: (event: PointerEvent) => void
  ): void => {
    dragHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || editingMode !== "adjust") return;
      event.preventDefault();
      event.stopPropagation();
      dragHandle.setPointerCapture(event.pointerId);
      dragHandle.dataset.dragging = "true";
    });
    dragHandle.addEventListener("pointermove", (event) => {
      if (dragHandle.hasPointerCapture(event.pointerId)) onMove(event);
    });
    const finish = (event: PointerEvent): void => {
      if (!dragHandle.hasPointerCapture(event.pointerId)) return;
      dragHandle.releasePointerCapture(event.pointerId);
      delete dragHandle.dataset.dragging;
      updateSettings({}, true);
    };
    dragHandle.addEventListener("pointerup", finish);
    dragHandle.addEventListener("pointercancel", finish);
  };

  const bindLayerDrag = (
    layer: HTMLElement,
    getPosition: () => {x: number; y: number},
    getSize: () => {width: number; height: number},
    applyPosition: (position: {x: number; y: number}) => void
  ): void => {
    let pointerOrigin: {x: number; y: number} | undefined;
    let positionOrigin: {x: number; y: number} | undefined;
    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || editingMode !== "adjust") return;
      const point = videoPoint(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      pointerOrigin = point;
      positionOrigin = getPosition();
      layer.setPointerCapture(event.pointerId);
      layer.dataset.dragging = "true";
    });
    layer.addEventListener("pointermove", (event) => {
      if (!layer.hasPointerCapture(event.pointerId) || !pointerOrigin || !positionOrigin) return;
      const point = videoPoint(event);
      if (!point) return;
      const size = getSize();
      applyPosition(clampRelativePosition({
        x: positionOrigin.x + point.x - pointerOrigin.x,
        y: positionOrigin.y + point.y - pointerOrigin.y
      }, size.width, size.height));
    });
    const finish = (event: PointerEvent): void => {
      if (!layer.hasPointerCapture(event.pointerId)) return;
      layer.releasePointerCapture(event.pointerId);
      pointerOrigin = undefined;
      positionOrigin = undefined;
      delete layer.dataset.dragging;
      updateSettings({}, true);
    };
    layer.addEventListener("pointerup", finish);
    layer.addEventListener("pointercancel", finish);
  };

  bindLayerDrag(
    text,
    () => ({x: settings.positionX, y: settings.positionY}),
    () => ({width: 0.04, height: 0.04}),
    (position) => updateSettings({positionX: position.x, positionY: position.y}, false)
  );
  bindLayerDrag(
    mask,
    () => ({x: settings.maskPositionX, y: settings.maskPositionY}),
    () => ({width: settings.maskWidthRatio, height: settings.maskHeightRatio}),
    (position) => updateSettings({maskPositionX: position.x, maskPositionY: position.y}, false)
  );
  for (const resizeHandle of resizeHandles) {
    const corner = resizeHandle.dataset.corner as ResizeCorner;
    bindDrag(resizeHandle, (event) => {
      const point = videoPoint(event);
      if (!point) return;
      const resized = resizeRelativeRectangleFromCorner(
        {
          centerX: settings.maskPositionX,
          centerY: settings.maskPositionY,
          width: settings.maskWidthRatio,
          height: settings.maskHeightRatio
        },
        corner,
        point,
        {minimumWidth: 0.25, maximumWidth: 0.95, minimumHeight: 0.05, maximumHeight: 0.35}
      );
      updateSettings({
        maskPositionX: resized.centerX,
        maskPositionY: resized.centerY,
        maskWidthRatio: resized.width,
        maskHeightRatio: resized.height
      }, false);
    });
  }

  window.addEventListener("resize", syncGeometry, {passive: true});
  document.addEventListener("scroll", syncGeometry, {capture: true, passive: true});

  const initialRevision = settingsRevision;
  void loadOverlaySettings()
    .then((stored) => {
      if (settingsRevision !== initialRevision) return;
      settings = stored;
      applyAppearance();
      syncGeometry();
      updateVisibility();
      notifySettings();
    })
    .catch(() => undefined);

  root.dataset.editMode = editingMode;
  syncContainer();
  return overlay;
}
