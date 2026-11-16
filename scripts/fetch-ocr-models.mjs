import {createHash} from "node:crypto";
import {access, mkdir, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "vendor/ppocrv5");
const commit = "3a180da5b1a3bab3371d970f4da42cb9b354a9a7";
const repository = "PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models";
const media = `https://media.githubusercontent.com/media/${repository}/${commit}`;
const raw = `https://raw.githubusercontent.com/${repository}/${commit}`;

const files = [
  {
    name: "PP-OCRv5_mobile_det_infer.onnx",
    url: `${media}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    sha256: "d7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924"
  },
  {
    name: "PP-OCRv5_mobile_rec_infer.onnx",
    url: `${media}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
    sha256: "d253c3cbee6e507828a5271a30ab0ec8ae7c2a99d0cc8e6f844fe380809d22b3"
  },
  {
    name: "ppocrv5_dict.txt",
    url: `${raw}/recognition/ppocrv5_dict.txt`,
    sha256: "9dfc80c50b6cb07399a47a7cf25d11db475fb4ad0e1fc96b2eff6467c8166ff3"
  },
  {
    name: "MODEL_LICENSE.txt",
    url: `${raw}/LICENSE`,
    sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
  }
];

await mkdir(outputDirectory, {recursive: true});

for (const file of files) {
  const destination = resolve(outputDirectory, file.name);
  try {
    await access(destination);
    const existing = await readFile(destination);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash === file.sha256) {
      process.stdout.write(`[skip] ${file.name} (verified)\n`);
      continue;
    }
    process.stdout.write(`[replace] ${file.name} (checksum mismatch)\n`);
  } catch {
    // Download below.
  }

  process.stdout.write(`[fetch] ${file.name}\n`);
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${file.url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== file.sha256) {
    throw new Error(`SHA-256 mismatch for ${file.name}: expected ${file.sha256}, received ${sha256}`);
  }
  await writeFile(destination, bytes);
  process.stdout.write(`[done] ${file.name} ${bytes.byteLength} bytes sha256=${sha256}\n`);
}
