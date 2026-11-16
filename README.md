# Bilibili OCR Subtitles

A Chrome extension that turns hardcoded Chinese subtitles on Bilibili videos into selectable HTML text. OCR runs locally in the browser, so the result can be selected, copied, and inspected with tools such as Yomitan.

## Features

- Automatic Chinese subtitle recognition with PP-OCRv5.
- Selectable, copyable light-DOM subtitle text.
- Start/pause, show/hide, and appearance controls inside the player.
- Independent text and background-mask positioning.
- Persistent settings across reloads and episode navigation.
- Normal, web-fullscreen, and native-fullscreen support.
- Optional diagnostics for media resolution and one-frame OCR testing.

Supported pages:

- `bilibili.com/video/*`
- `bilibili.com/bangumi/play/*`

## Install

Node.js is not required to install the extension.

1. Download the ZIP from the [latest release](https://github.com/waterfalleq/bilibili-selectable-subtitles/releases/latest).
2. Extract it somewhere you intend to keep it.
3. Open `chrome://extensions` in a Chromium-based browser.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted `bilibili-selectable-subtitles` folder.
6. Reload an open Bilibili video page.

Chrome only permits one-click extension installation through the Chrome Web Store. The release ZIP is already built; loading its extracted folder does not require the source code or development tools.

## Use

The extension adds a small **OCR** button near the top-right of the video.

- **Start OCR / Pause OCR** controls automatic recognition.
- **Show subtitles / Hide subtitles** controls the HTML overlay.
- **Adjust subtitles** lets you drag the text and mask independently and resize the mask from its corners.
- **Appearance** changes text size, mask opacity, and padding.
- **Advanced diagnostics** exposes troubleshooting information and manual capture.

Outside adjustment mode, subtitle text remains selectable and compatible with Shift-hover dictionary lookup.

## Development

Building from source requires Node.js 20.19 or newer.

```bash
npm install
npm run build
```

Load the generated `dist` directory from `chrome://extensions`.

```bash
npm run typecheck
npm test
npm run build
```

Run all three with:

```bash
npm run check
```

The repository includes pinned PP-OCRv5 model files. To re-download or verify them:

```bash
npm run fetch:ocr-models
```

Browser smoke checks are also available:

```bash
npm run smoke:auto
npm run smoke:overlay
```

They write temporary evidence to the ignored `spike-results` directory.

## Privacy

- Video frames are processed locally by packaged OCR models.
- Recognized text and captured frames are not uploaded to a project server.
- Only overlay settings and the automatic-OCR preference are stored locally.
- The extension does not request cookie access or inspect authentication cookies.
- Bilibili metadata requests may use the browser's existing Bilibili session under normal browser rules.

## Limitations

- Designed for Chromium-based browsers and Bilibili's current player structure.
- OCR accuracy depends on video quality, subtitle styling, motion, and compression.
- The first recognition can be slower while the local model initializes.
- Bilibili page or API changes may require updates.

This is an independent project and is not affiliated with Bilibili.

Third-party components and model licenses are listed in [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md). No license has yet been chosen for the project's own source code.
