import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {chromium} from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionDirectory = resolve(root, "dist");
const profileDirectory = await mkdtemp(join(tmpdir(), "bso-overlay-"));
const targetUrl = process.argv[2] ?? "https://www.bilibili.com/bangumi/play/ep815578";
const context = await chromium.launchPersistentContext(profileDirectory, {
  executablePath: chromium.executablePath(),
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionDirectory}`,
    `--load-extension=${extensionDirectory}`,
    "--autoplay-policy=no-user-gesture-required"
  ]
});

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(targetUrl, {waitUntil: "domcontentloaded", timeout: 45_000});
  await page.locator("#bso-player-controls .bso-player-control-trigger").waitFor({state: "visible", timeout: 30_000});
  await page.locator("video").waitFor({state: "attached", timeout: 30_000});
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && video.videoWidth > 0 && video.videoHeight > 0;
  }, undefined, {timeout: 45_000});

  const defaultDiagnosticCount = await page.locator("#bso-diagnostic-panel").count();
  await page.locator(".bso-player-control-trigger").click();
  await page.locator("#bso-player-menu").waitFor({state: "visible"});
  await page.locator(".bso-debug-action").click();
  await page.locator("#bso-diagnostic-panel").waitFor({state: "visible"});
  await page.locator(".bso-debug-action").click();
  await page.locator("#bso-diagnostic-panel").waitFor({state: "hidden"});
  await page.locator(".bso-player-control-trigger").click();
  await page.locator("#bso-player-menu").waitFor({state: "hidden"});
  await showTestText(page);
  const initial = await snapshot(page);

  await setRange(page, "#bso-overlay-fontSizePx", "38");
  await setRange(page, "#bso-overlay-backgroundOpacity", "0.41");
  await setRange(page, "#bso-overlay-paddingPx", "15");

  await activateAdjustment(page);
  const adjustmentEntered = await snapshot(page);
  await dragHandle(page, ".bso-manual-subtitle-text", -80, -55);
  const textMoved = await snapshot(page);

  await dragHandle(page, ".bso-subtitle-mask", 65, -35);
  const maskMoved = await snapshot(page);

  await dragHandle(page, '.bso-mask-resize-handle[data-corner="south-east"]', 55, 25);
  const adjusted = await snapshot(page);
  await openMenu(page);
  const screenshotPath = resolve(root, "spike-results", "overlay-ux-smoke.png");
  await page.screenshot({path: screenshotPath});
  await page.locator(".bso-player-control-trigger").click();
  await page.locator(".bso-adjustment-done").click();
  await showTestText(page);
  const doneExited = await snapshot(page);

  await activateAdjustment(page);
  await page.keyboard.press("Escape");
  await showTestText(page);
  const escapeExited = await snapshot(page);

  await page.setViewportSize({width: 1120, height: 720});
  await page.waitForTimeout(100);
  const resized = await snapshot(page);

  await page.reload({waitUntil: "domcontentloaded", timeout: 45_000});
  await page.locator("#bso-player-controls .bso-player-control-trigger").waitFor({state: "visible", timeout: 30_000});
  await page.locator("video").waitFor({state: "attached", timeout: 30_000});
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && video.videoWidth > 0 && video.videoHeight > 0;
  }, undefined, {timeout: 45_000});
  await showTestText(page);
  await page.waitForTimeout(250);
  const reloaded = await snapshot(page);

  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "bso-smoke-fullscreen";
    trigger.textContent = "test fullscreen";
    trigger.style.position = "fixed";
    trigger.style.left = "0";
    trigger.style.top = "0";
    trigger.style.zIndex = "2147483647";
    trigger.addEventListener("click", () => {
      const video = document.querySelector("video");
      const container = video?.parentElement;
      void container?.requestFullscreen();
    });
    document.documentElement.append(trigger);
  });
  await page.locator("#bso-smoke-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement !== null, undefined, {timeout: 10_000});
  await page.waitForTimeout(100);
  const fullscreen = await snapshot(page);
  await openMenu(page);
  const fullscreenMenuVisible = await page.locator("#bso-player-menu").isVisible();
  await page.locator(".bso-player-control-trigger").click();
  await page.evaluate(() => document.exitFullscreen());

  await openMenu(page);
  const automaticAction = page.locator(".bso-automatic-action");
  if ((await automaticAction.textContent())?.includes("Start")) await automaticAction.click();
  await page.waitForTimeout(300);
  await page.reload({waitUntil: "domcontentloaded", timeout: 45_000});
  await page.locator("#bso-player-controls .bso-player-control-trigger").waitFor({state: "visible", timeout: 30_000});
  await openMenu(page);
  await page.waitForFunction(() => {
    const button = document.querySelector(".bso-automatic-action");
    return button?.textContent?.includes("Pause OCR");
  }, undefined, {timeout: 30_000});
  const automaticPreferenceRestored = (await page.locator(".bso-automatic-action").textContent())
    ?.includes("Pause OCR") ?? false;
  await page.evaluate(() => {
    const cue = document.createElement("div");
    cue.id = "bso-smoke-native-cue";
    cue.className = "bpx-player-subtitle-panel-text";
    cue.textContent = "原生中文字幕";
    cue.style.position = "fixed";
    cue.style.left = "20px";
    cue.style.top = "20px";
    document.documentElement.append(cue);
  });
  await page.waitForFunction(() => {
    const status = document.querySelector(".bso-player-status");
    return status?.textContent?.includes("Bilibili Chinese subtitles active");
  }, undefined, {timeout: 5000});
  const nativeSuppressionWorked = await page.locator(".bso-player-status").evaluate((element) =>
    element.textContent?.includes("Bilibili Chinese subtitles active") ?? false
  );
  await page.locator(".bso-automatic-override").waitFor({state: "visible"});
  await page.evaluate(() => document.querySelector("#bso-smoke-native-cue")?.remove());
  await page.locator(".bso-automatic-action").click();

  const report = {
    targetUrl,
    screenshotPath,
    defaultDiagnosticCount,
    initial,
    adjustmentEntered,
    textMoved,
    maskMoved,
    adjusted,
    doneExited,
    escapeExited,
    resized,
    reloaded,
    fullscreen,
    fullscreenMenuVisible,
    oneClickEnteredAdjustment:
      adjustmentEntered.editMode === "adjust" &&
      adjustmentEntered.visibleEditingHandles === 4 &&
      adjustmentEntered.adjustmentToolbarVisible,
    directManipulationStayedUnified:
      textMoved.editMode === "adjust" &&
      maskMoved.editMode === "adjust" &&
      adjusted.editMode === "adjust",
    textMovedIndependently:
      pointsDiffer(textMoved.textPosition, initial.textPosition) &&
      pointsMatch(textMoved.maskGeometry, initial.maskGeometry),
    maskMovedIndependently:
      pointsDiffer(maskMoved.maskGeometry, textMoved.maskGeometry) &&
      pointsMatch(maskMoved.textPosition, textMoved.textPosition) &&
      Math.abs(maskMoved.maskGeometry.width - textMoved.maskGeometry.width) < 0.002 &&
      Math.abs(maskMoved.maskGeometry.height - textMoved.maskGeometry.height) < 0.002,
    maskResizedIndependently:
      (Math.abs(adjusted.maskGeometry.width - maskMoved.maskGeometry.width) > 0.01 ||
        Math.abs(adjusted.maskGeometry.height - maskMoved.maskGeometry.height) > 0.01) &&
      pointsMatch(adjusted.textPosition, maskMoved.textPosition),
    doneExitedAdjustment:
      doneExited.editMode === "none" &&
      doneExited.visibleEditingHandles === 0 &&
      !doneExited.adjustmentToolbarVisible,
    escapeExitedAdjustment:
      escapeExited.editMode === "none" &&
      escapeExited.visibleEditingHandles === 0 &&
      !escapeExited.adjustmentToolbarVisible,
    appearancePersisted:
      reloaded.controls.fontSizePx === "38" &&
      reloaded.controls.backgroundOpacity === "0.41" &&
      reloaded.controls.paddingPx === "15",
    relativePositionPersisted:
      Math.abs(reloaded.textPosition.x - adjusted.textPosition.x) < 0.002 &&
      Math.abs(reloaded.textPosition.y - adjusted.textPosition.y) < 0.002 &&
      Math.abs(reloaded.maskGeometry.x - adjusted.maskGeometry.x) < 0.002 &&
      Math.abs(reloaded.maskGeometry.y - adjusted.maskGeometry.y) < 0.002 &&
      Math.abs(reloaded.maskGeometry.width - adjusted.maskGeometry.width) < 0.002 &&
      Math.abs(reloaded.maskGeometry.height - adjusted.maskGeometry.height) < 0.002,
    resizedToVideo:
      Math.abs(resized.root.width - resized.video.width) < 1 &&
      Math.abs(resized.root.height - resized.video.height) < 1,
    fullscreenReparented: fullscreen.overlayParentIsFullscreen,
    textSelectable: reloaded.selectedText === "可选择的测试字幕",
    maskIsMouseTransparent: reloaded.maskPointerEvents === "none",
    editingHandlesHiddenNormally: reloaded.visibleEditingHandles === 0,
    diagnosticsHiddenByDefault: defaultDiagnosticCount === 0,
    automaticPreferenceRestored,
    nativeSuppressionWorked,
    controlCount: await page.locator("#bso-player-controls").count()
  };
  const reportPath = resolve(root, "spike-results", "overlay-ux-smoke.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({...report, reportPath}, null, 2)}\n`);
} finally {
  await context.close();
}

async function showTestText(page) {
  await page.evaluate(() => {
    const root = document.querySelector("#bso-manual-subtitle-overlay");
    const text = root?.querySelector(".bso-manual-subtitle-text");
    if (!(root instanceof HTMLElement) || !(text instanceof HTMLElement)) {
      throw new Error("Overlay was not created.");
    }
    text.textContent = "可选择的测试字幕";
    root.hidden = false;
  });
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  }, value);
}

async function activateAdjustment(page) {
  await openMenu(page);
  await page.locator(".bso-adjust-action").click();
  await page.locator("#bso-player-menu").waitFor({state: "hidden"});
  await page.locator(".bso-adjustment-toolbar").waitFor({state: "visible"});
}

async function dragHandle(page, selector, deltaX, deltaY) {
  const handle = page.locator(selector);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Editing handle was not visible: ${selector}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, {steps: 6});
  await page.mouse.up();
  await page.waitForTimeout(250);
}

function pointsDiffer(left, right) {
  return Math.abs(left.x - right.x) > 0.01 || Math.abs(left.y - right.y) > 0.01;
}

function pointsMatch(left, right) {
  return Math.abs(left.x - right.x) < 0.002 && Math.abs(left.y - right.y) < 0.002;
}

async function openMenu(page) {
  const menu = page.locator("#bso-player-menu");
  if (!await menu.isVisible()) await page.locator(".bso-player-control-trigger").click();
  await menu.waitFor({state: "visible"});
}

async function snapshot(page) {
  return page.evaluate(() => {
    const video = document.querySelector("video");
    const root = document.querySelector("#bso-manual-subtitle-overlay");
    const text = root?.querySelector(".bso-manual-subtitle-text");
    const mask = root?.querySelector(".bso-subtitle-mask");
    if (!(video instanceof HTMLVideoElement) || !(root instanceof HTMLElement) ||
        !(text instanceof HTMLElement) || !(mask instanceof HTMLElement)) {
      throw new Error("Smoke-test elements were missing.");
    }
    const videoRect = video.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const maskRect = mask.getBoundingClientRect();
    const selection = getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection?.addRange(range);
    const controls = Object.fromEntries([
      "fontSizePx",
      "backgroundOpacity",
      "paddingPx"
    ].map((name) => [name, document.querySelector(`#bso-overlay-${name}`)?.value]));
    const rectangle = (value) => ({
      left: value.left,
      top: value.top,
      width: value.width,
      height: value.height
    });
    return {
      video: rectangle(videoRect),
      root: rectangle(rootRect),
      textPosition: {
        x: (textRect.left + textRect.width / 2 - rootRect.left) / rootRect.width,
        y: (textRect.top + textRect.height / 2 - rootRect.top) / rootRect.height
      },
      maskGeometry: {
        x: (maskRect.left + maskRect.width / 2 - rootRect.left) / rootRect.width,
        y: (maskRect.top + maskRect.height / 2 - rootRect.top) / rootRect.height,
        width: maskRect.width / rootRect.width,
        height: maskRect.height / rootRect.height
      },
      controls,
      selectedText: selection?.toString() ?? "",
      textUserSelect: getComputedStyle(text).userSelect,
      maskPointerEvents: getComputedStyle(mask).pointerEvents,
      visibleEditingHandles: [...root.querySelectorAll(".bso-mask-resize-handle")]
        .filter((element) => getComputedStyle(element).display !== "none").length,
      editMode: root.dataset.editMode ?? "none",
      adjustmentToolbarVisible:
        getComputedStyle(root.querySelector(".bso-adjustment-toolbar")).display !== "none",
      overlayParentIsFullscreen: root.parentElement === document.fullscreenElement
    };
  });
}
