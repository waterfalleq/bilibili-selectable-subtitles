import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {chromium} from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionDirectory = resolve(root, "dist");
const profileDirectory = await mkdtemp(join(tmpdir(), "bso-auto-"));
const targetUrl = process.argv[2] ?? "https://www.bilibili.com/bangumi/play/ep815578";
const startTime = Number(process.argv[3] ?? 70);
const playbackSeconds = Number(process.argv[4] ?? 20);
const targetSlug = targetUrl.match(/\/(ep|ss)(\d+)/)?.slice(1).join("") ?? "unknown";

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
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto(targetUrl, {waitUntil: "domcontentloaded", timeout: 45_000});
  await page.locator("#bso-player-controls .bso-player-control-trigger").waitFor({state: "visible", timeout: 30_000});
  await page.locator("video").waitFor({state: "attached", timeout: 30_000});
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
  }, undefined, {timeout: 45_000});

  await page.evaluate(async (seconds) => {
    const video = document.querySelector("video");
    if (!video) throw new Error("No video element");
    video.muted = true;
    video.pause();
    await new Promise((resolveSeek, rejectSeek) => {
      const timeout = setTimeout(() => rejectSeek(new Error("seek timeout")), 10_000);
      video.addEventListener("seeked", () => {
        clearTimeout(timeout);
        resolveSeek(undefined);
      }, {once: true});
      video.currentTime = seconds;
    });
    window.__bsoTransitions = [];
    const text = document.querySelector("#bso-manual-subtitle-overlay .bso-manual-subtitle-text");
    if (text) {
      new MutationObserver(() => {
        window.__bsoTransitions.push({time: video.currentTime, text: text.textContent ?? ""});
      }).observe(text, {childList: true, characterData: true, subtree: true});
    }
  }, startTime);

  await openMenu(page);
  await page.locator(".bso-debug-action").click();
  await page.locator("#bso-diagnostic-panel").waitFor({state: "visible"});
  await page.locator(".bso-automatic-action").click();
  await page.locator(".bso-player-control-trigger").click();
  await page.evaluate(() => document.querySelector("video")?.play());
  await page.waitForTimeout(playbackSeconds * 1000);

  const beforePause = await snapshot(page);
  await page.evaluate(() => document.querySelector("video")?.pause());
  await page.waitForTimeout(2_000);
  const paused = await snapshot(page);
  await page.waitForTimeout(1_000);
  const pausedLater = await snapshot(page);
  await page.evaluate(() => document.querySelector("video")?.play());
  await page.waitForTimeout(2_000);

  const seekTarget = startTime + playbackSeconds + 15;
  await page.evaluate(async (seconds) => {
    const video = document.querySelector("video");
    if (!video) throw new Error("No video element");
    await new Promise((resolveSeek, rejectSeek) => {
      const timeout = setTimeout(() => rejectSeek(new Error("seek timeout")), 10_000);
      video.addEventListener("seeked", () => {
        clearTimeout(timeout);
        resolveSeek(undefined);
      }, {once: true});
      video.currentTime = seconds;
    });
    await video.play();
  }, seekTarget);
  const immediatelyAfterSeek = await snapshot(page);
  await page.waitForTimeout(5_000);
  const afterSeek = await snapshot(page);

  await openMenu(page);
  await page.locator(".bso-automatic-action").click();
  const stopped = await snapshot(page);
  await page.waitForTimeout(2_000);
  const stoppedLater = await snapshot(page);

  const report = {
    targetUrl,
    requestedPlaybackSeconds: playbackSeconds,
    source: await page.locator("video").evaluate((video) => ({
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      playbackRate: video.playbackRate
    })),
    beforePause,
    paused,
    pausedLater,
    pausePreservedText: paused.overlayText === pausedLater.overlayText,
    immediatelyAfterSeek,
    afterSeek,
    seekClearedOldText: immediatelyAfterSeek.overlayText === "",
    stopped,
    stoppedLater,
    stoppedProcessing: stopped.metrics["OCR calls"] === stoppedLater.metrics["OCR calls"],
    overlayCount: await page.locator("#bso-manual-subtitle-overlay").count(),
    transitions: await page.evaluate(() => window.__bsoTransitions),
    browserErrors
  };
  const reportPath = resolve(root, "spike-results", `automatic-ocr-smoke-${targetSlug}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({...report, reportPath}, null, 2)}\n`);
} finally {
  await context.close();
}

async function snapshot(page) {
  return {
    videoTime: await page.locator("video").evaluate((video) => video.currentTime),
    overlayText: await page.locator("#bso-manual-subtitle-overlay .bso-manual-subtitle-text").innerText(),
    overlayHidden: await page.locator("#bso-manual-subtitle-overlay").evaluate((element) => element.hasAttribute("hidden")),
    status: await page.locator(".bso-automatic-status").innerText(),
    metrics: await readDefinitionList(page.locator(".bso-automatic-metrics"))
  };
}

async function openMenu(page) {
  const menu = page.locator("#bso-player-menu");
  if (!await menu.isVisible()) await page.locator(".bso-player-control-trigger").click();
  await menu.waitFor({state: "visible"});
}

async function readDefinitionList(locator) {
  return locator.evaluate((list) => {
    const entries = {};
    let key;
    for (const child of list.children) {
      if (child.tagName === "DT") key = child.textContent?.trim();
      if (child.tagName === "DD" && key) {
        entries[key] = child.textContent?.trim() ?? "";
        key = undefined;
      }
    }
    return entries;
  });
}
