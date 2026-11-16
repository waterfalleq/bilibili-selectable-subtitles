import type {AutomaticOcrSnapshot} from "../experiment/automaticOcr";
import {findActiveVideo} from "../experiment/frameCapture";
import type {ManualSubtitleOverlay} from "../experiment/manualOverlay";
import {fitVideoContentRect} from "../experiment/overlayGeometry";
import type {OverlaySettings} from "../experiment/overlaySettings";

const CONTROLS_ID = "bso-player-controls";
const VIDEO_MONITOR_INTERVAL_MS = 750;

export interface AutomaticControlState {
  preferenceLoaded: boolean;
  preferred: boolean;
  suppressedByNative: boolean;
  snapshot: AutomaticOcrSnapshot;
}

export interface CompactPlayerControls {
  root: HTMLDivElement;
  syncContainer: () => void;
  setAutomaticState: (state: AutomaticControlState) => void;
  setDebugVisible: (visible: boolean) => void;
  showNotice: (message: string, tone?: "neutral" | "warning" | "error") => void;
}

export function createCompactPlayerControls(options: {
  overlay: ManualSubtitleOverlay;
  onAutomaticAction: () => void;
  onAutomaticOverride: () => void;
  onDebugVisibilityChange: (visible: boolean) => void;
}): CompactPlayerControls {
  document.getElementById(CONTROLS_ID)?.remove();

  const root = document.createElement("div");
  root.id = CONTROLS_ID;
  root.hidden = true;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "bso-player-control-trigger";
  trigger.textContent = "OCR";
  trigger.title = "OCR subtitle controls";
  trigger.setAttribute("aria-label", "Open OCR subtitle controls");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("section");
  menu.id = "bso-player-menu";
  menu.hidden = true;
  menu.setAttribute("aria-label", "OCR subtitle controls");

  const header = document.createElement("header");
  header.className = "bso-menu-header";
  const brand = document.createElement("span");
  brand.className = "bso-menu-brand";
  brand.textContent = "OCR";
  brand.setAttribute("aria-hidden", "true");
  const title = document.createElement("h2");
  title.textContent = "OCR Subtitles";
  header.append(brand, title);

  const statusCard = document.createElement("div");
  statusCard.className = "bso-runtime-card";
  const statusDot = document.createElement("span");
  statusDot.className = "bso-runtime-dot";
  statusDot.setAttribute("aria-hidden", "true");
  const status = document.createElement("p");
  status.className = "bso-player-status";
  statusCard.append(statusDot, status);

  const primary = document.createElement("div");
  primary.className = "bso-primary-actions";
  const automaticButton = createActionButton("bso-automatic-action");
  automaticButton.addEventListener("click", options.onAutomaticAction);
  const overlayButton = createActionButton("bso-overlay-action");
  const renderOverlayButton = (): void => {
    const enabled = options.overlay.isEnabled();
    setButtonContent(overlayButton, enabled ? "◉" : "○", enabled ? "Hide subtitles" : "Show subtitles");
    overlayButton.setAttribute("aria-pressed", String(enabled));
  };
  overlayButton.addEventListener("click", () => {
    options.overlay.setEnabled(!options.overlay.isEnabled());
    renderOverlayButton();
  });
  options.overlay.subscribeSettings(renderOverlayButton);
  primary.append(automaticButton, overlayButton);

  const overrideButton = createActionButton("bso-automatic-override");
  setButtonContent(overrideButton, "▶", "Use OCR for this video");
  overrideButton.hidden = true;
  overrideButton.addEventListener("click", options.onAutomaticOverride);

  const adjust = document.createElement("section");
  adjust.className = "bso-adjust-controls";
  const adjustButton = createActionButton("bso-adjust-action");
  setButtonContent(adjustButton, "✥", "Adjust subtitles…");
  adjustButton.addEventListener("click", () => {
    const entering = options.overlay.getEditingMode() !== "adjust";
    if (entering) options.overlay.setEnabled(true);
    options.overlay.setEditingMode(entering ? "adjust" : "none");
    setMenuOpen(false);
  });
  adjust.append(adjustButton);

  const reset = createActionButton("bso-reset-action");
  setButtonContent(reset, "↻", "Reset");
  reset.addEventListener("click", () => {
    options.overlay.resetSettings();
    options.overlay.setEditingMode("none");
  });
  options.overlay.subscribeEditingMode((mode) => {
    const active = mode === "adjust";
    setButtonContent(adjustButton, active ? "✓" : "✥", active ? "Done adjusting" : "Adjust subtitles…");
    adjustButton.setAttribute("aria-pressed", String(active));
    adjustButton.dataset.active = String(active);
  });

  const appearance = createAppearanceControls(options.overlay);

  const debugButton = createActionButton("bso-debug-action");
  let debugVisible = false;
  const renderDebugButton = (): void => {
    setButtonContent(debugButton, "⌁", debugVisible ? "Close diagnostics" : "Advanced diagnostics", "›");
    debugButton.setAttribute("aria-pressed", String(debugVisible));
  };
  debugButton.addEventListener("click", () => {
    debugVisible = !debugVisible;
    renderDebugButton();
    options.onDebugVisibilityChange(debugVisible);
  });
  renderDebugButton();

  const secondaryActions = document.createElement("div");
  secondaryActions.className = "bso-secondary-actions";
  secondaryActions.append(reset, debugButton);

  const notice = document.createElement("p");
  notice.className = "bso-player-notice";
  notice.hidden = true;
  let noticeTimer: number | undefined;

  menu.append(header, statusCard, primary, overrideButton, adjust, appearance, secondaryActions);
  root.append(trigger, menu, notice);
  document.documentElement.append(root);

  let observedVideo: HTMLVideoElement | undefined;
  let observedContainer: HTMLElement | undefined;
  const resizeObserver = new ResizeObserver(() => syncGeometry());

  const syncGeometry = (): void => {
    const video = findActiveVideo();
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      root.hidden = true;
      return;
    }
    const rect = fitVideoContentRect(
      video.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
      getComputedStyle(video).objectFit
    );
    root.hidden = false;
    root.style.left = `${rect.left + rect.width - 10}px`;
    root.style.top = `${rect.top + 10}px`;
    root.style.setProperty("--bso-menu-max-height", `${Math.max(180, rect.height - 54)}px`);
  };

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
    syncGeometry();
  };

  const setMenuOpen = (open: boolean): void => {
    menu.hidden = !open;
    root.dataset.open = String(open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      menu.scrollTop = 0;
      syncGeometry();
    }
  };
  trigger.addEventListener("click", () => setMenuOpen(menu.hasAttribute("hidden")));
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !root.contains(event.target as Node)) setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    options.overlay.setEditingMode("none");
    if (!menu.hidden) {
      setMenuOpen(false);
      trigger.focus();
    }
  });

  window.addEventListener("resize", syncGeometry, {passive: true});
  document.addEventListener("scroll", syncGeometry, {capture: true, passive: true});
  window.setInterval(syncContainer, VIDEO_MONITOR_INTERVAL_MS);
  syncContainer();

  return {
    root,
    syncContainer,
    setAutomaticState(state) {
      automaticButton.setAttribute("aria-pressed", String(state.preferred));
      statusCard.dataset.tone = "off";
      if (!state.preferenceLoaded) {
        automaticButton.disabled = true;
        setButtonContent(automaticButton, "…", "Preparing OCR…");
        status.textContent = "Preparing subtitle controls";
        return;
      }
      automaticButton.disabled = false;
      setButtonContent(
        automaticButton,
        state.preferred ? "Ⅱ" : "▶",
        state.preferred ? "Pause OCR" : "Start OCR"
      );
      overrideButton.hidden = !state.suppressedByNative;

      if (state.suppressedByNative) {
        statusCard.dataset.tone = "native";
        status.textContent = "Bilibili Chinese subtitles active";
      } else if (state.snapshot.mode === "error") {
        statusCard.dataset.tone = "error";
        status.textContent = "OCR needs attention";
      } else if (state.snapshot.mode === "recognizing") {
        statusCard.dataset.tone = "active";
        status.textContent = "Recognizing subtitles";
      } else if (state.snapshot.mode === "paused") {
        statusCard.dataset.tone = "active";
        status.textContent = "Automatic subtitles ready";
      } else if (state.snapshot.enabled) {
        statusCard.dataset.tone = "active";
        status.textContent = "Automatic subtitles on";
      } else if (state.preferred) {
        statusCard.dataset.tone = "waiting";
        status.textContent = "Waiting for the video";
      } else {
        status.textContent = "Automatic subtitles off";
      }
    },
    setDebugVisible(visible) {
      debugVisible = visible;
      renderDebugButton();
    },
    showNotice(message, tone = "neutral") {
      notice.textContent = message;
      notice.dataset.tone = tone;
      notice.hidden = false;
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => {
        notice.hidden = true;
        noticeTimer = undefined;
      }, 5000);
    }
  };
}

function createAppearanceControls(overlay: ManualSubtitleOverlay): HTMLElement {
  type AppearanceSettingKey = "fontSizePx" | "backgroundOpacity" | "paddingPx";
  const root = document.createElement("section");
  root.className = "bso-menu-card bso-appearance-settings";
  root.append(createSectionHeading("◉", "Appearance"));
  const bindings: Array<{
    key: AppearanceSettingKey;
    input: HTMLInputElement;
    output: HTMLOutputElement;
    format: (value: number) => string;
  }> = [];

  const addRange = (
    labelText: string,
    icon: string,
    key: AppearanceSettingKey,
    minimum: number,
    maximum: number,
    step: number,
    format: (value: number) => string
  ): void => {
    const row = document.createElement("div");
    row.className = "bso-appearance-row";
    const label = document.createElement("label");
    const labelIcon = document.createElement("span");
    labelIcon.className = "bso-row-icon";
    labelIcon.textContent = icon;
    const labelTextNode = document.createElement("span");
    labelTextNode.textContent = labelText;
    const input = document.createElement("input");
    const output = document.createElement("output");
    input.type = "range";
    input.min = String(minimum);
    input.max = String(maximum);
    input.step = String(step);
    input.id = `bso-overlay-${key}`;
    label.htmlFor = input.id;
    label.append(labelIcon, labelTextNode);
    input.addEventListener("input", () => overlay.updateSettings(
      {[key]: Number(input.value)} as Partial<OverlaySettings>
    ));
    row.append(label, input, output);
    root.append(row);
    bindings.push({key, input, output, format});
  };

  addRange("Text size", "A", "fontSizePx", 16, 52, 1, (value) => `${Math.round(value)}px`);
  addRange("Mask opacity", "◒", "backgroundOpacity", 0, 0.95, 0.01, (value) => `${Math.round(value * 100)}%`);
  addRange("Padding", "□", "paddingPx", 0, 32, 1, (value) => `${Math.round(value)}px`);

  overlay.subscribeSettings((settings) => {
    for (const binding of bindings) {
      const value = settings[binding.key];
      if (typeof value !== "number") continue;
      binding.input.value = String(value);
      binding.output.value = binding.format(value);
    }
  });
  return root;
}

function createActionButton(extraClass: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `bso-menu-action ${extraClass}`;
  return button;
}

function setButtonContent(
  button: HTMLButtonElement,
  icon: string,
  label: string,
  trailing = ""
): void {
  const iconElement = document.createElement("span");
  iconElement.className = "bso-button-icon";
  iconElement.textContent = icon;
  iconElement.setAttribute("aria-hidden", "true");
  const labelElement = document.createElement("span");
  labelElement.className = "bso-button-label";
  labelElement.textContent = label;
  button.replaceChildren(iconElement, labelElement);
  if (trailing) {
    const trailingElement = document.createElement("span");
    trailingElement.className = "bso-button-trailing";
    trailingElement.textContent = trailing;
    trailingElement.setAttribute("aria-hidden", "true");
    button.append(trailingElement);
  }
}

function createSectionHeading(icon: string, label: string): HTMLElement {
  const heading = document.createElement("h3");
  const iconElement = document.createElement("span");
  iconElement.className = "bso-section-icon";
  iconElement.textContent = icon;
  iconElement.setAttribute("aria-hidden", "true");
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  heading.append(iconElement, labelElement);
  return heading;
}
