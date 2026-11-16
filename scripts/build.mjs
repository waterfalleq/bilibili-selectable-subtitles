import {copyFile, mkdir, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {build} from "vite";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");

await rm(outputDirectory, {recursive: true, force: true});
await mkdir(outputDirectory, {recursive: true});

async function buildEntry(entry, fileName, globalName) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      outDir: outputDirectory,
      minify: false,
      sourcemap: true,
      lib: {
        entry: resolve(root, entry),
        formats: ["iife"],
        name: globalName,
        fileName: () => fileName
      }
    }
  });
}

async function buildModuleEntry(entry, fileName) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    define: {"process.env.NODE_ENV": '"production"'},
    resolve: {
      dedupe: ["onnxruntime-web"],
      // Use the deterministic WASM backend and avoid packaging the unused
      // WebGPU/JSEP binary.
      // Alias both our import and ppu-paddle-ocr's import to ORT's WASM-only entry.
      alias: [
        {
          find: /^onnxruntime-web$/,
          replacement: resolve(root, "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")
        }
      ]
    },
    optimizeDeps: {exclude: ["onnxruntime-web"]},
    build: {
      emptyOutDir: false,
      outDir: outputDirectory,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, entry),
        output: {
          format: "es",
          entryFileNames: fileName,
          chunkFileNames: "chunks/[name]-[hash].js"
        }
      }
    }
  });
}

await buildEntry("src/content.ts", "content.js", "BilibiliOcrSubtitlesContent");
await buildEntry("src/background.ts", "background.js", "BilibiliOcrSubtitlesBackground");
await buildModuleEntry("src/offscreen.ts", "offscreen.js");

await copyFile(resolve(root, "public/manifest.json"), resolve(outputDirectory, "manifest.json"));
await copyFile(resolve(root, "public/diagnostic.css"), resolve(outputDirectory, "diagnostic.css"));
await copyFile(resolve(root, "public/offscreen.html"), resolve(outputDirectory, "offscreen.html"));
await copyFile(
  resolve(root, "public/THIRD_PARTY_LICENSES.md"),
  resolve(outputDirectory, "THIRD_PARTY_LICENSES.md")
);

const paddleDirectory = resolve(outputDirectory, "ppocrv5");
await mkdir(paddleDirectory, {recursive: true});
for (const name of [
  "PP-OCRv5_mobile_det_infer.onnx",
  "PP-OCRv5_mobile_rec_infer.onnx",
  "ppocrv5_dict.txt",
  "MODEL_LICENSE.txt"
]) {
  await copyFile(resolve(root, "vendor/ppocrv5", name), resolve(paddleDirectory, name));
}

const ortDirectory = resolve(outputDirectory, "ort");
await mkdir(ortDirectory, {recursive: true});
for (const name of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await copyFile(resolve(root, "node_modules/onnxruntime-web/dist", name), resolve(ortDirectory, name));
}

const tesseractDirectory = resolve(outputDirectory, "tesseract");
const coreDirectory = resolve(tesseractDirectory, "core");
const languageDirectory = resolve(tesseractDirectory, "lang");
await mkdir(coreDirectory, {recursive: true});
await mkdir(languageDirectory, {recursive: true});

await copyFile(
  resolve(root, "node_modules/tesseract.js/dist/worker.min.js"),
  resolve(tesseractDirectory, "worker.min.js")
);
for (const name of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm"
]) {
  await copyFile(resolve(root, "node_modules/tesseract.js-core", name), resolve(coreDirectory, name));
}
await copyFile(
  resolve(root, "node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz"),
  resolve(languageDirectory, "chi_sim.traineddata.gz")
);
