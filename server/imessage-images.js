import { createWorker, OEM, PSM } from "tesseract.js";
import sharp from "sharp";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processImageText } from "./imessage-guide.js";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const OCR_IMAGE_EDGE = 1280;
const OCR_TIMEOUT_MS = 20_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let workerPromise;

export function isSupportedImageAttachment(attachment) {
  const mimeType = String(attachment.mimeType || "").toLowerCase().split(";", 1)[0].trim();
  const fileExtension = String(attachment.name || "")
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0];
  return SUPPORTED_IMAGE_TYPES.has(mimeType) || SUPPORTED_IMAGE_EXTENSIONS.has(fileExtension);
}

export async function normalizeImageForOcr(input) {
  return sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
    .rotate()
    .resize({
      width: OCR_IMAGE_EDGE,
      height: OCR_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: projectRoot,
      gzip: false,
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function scanIMessageAttachment(state, attachment) {
  if (!isSupportedImageAttachment(attachment)) {
    return {
      state,
      reply: "I couldn't recognize that as a supported photo. Send a JPEG, PNG, or WebP image, or type the sign's words and train direction.",
    };
  }
  if (Number.isFinite(attachment.size) && attachment.size > MAX_ATTACHMENT_BYTES) {
    return {
      state,
      reply: "That image is over 12 MB, so I couldn't read it. Please send a smaller, clear photo of the sign.",
    };
  }

  const bytes = await attachment.read();
  if (!bytes?.length || bytes.length > MAX_ATTACHMENT_BYTES) {
    return {
      state,
      reply: "That image is empty or over 12 MB, so I couldn't read it. Please send a smaller photo.",
    };
  }

  let normalizedImage;
  try {
    normalizedImage = await normalizeImageForOcr(Buffer.from(bytes));
  } catch {
    return {
      state,
      reply: "I received the photo but couldn't decode it. Try sending it as JPEG, PNG, or WebP, or type the sign's words and train direction.",
    };
  }

  const worker = await getWorker();
  let timeout;
  try {
    const result = await Promise.race([
      worker.recognize(normalizedImage),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("The photo reader timed out.")), OCR_TIMEOUT_MS);
      }),
    ]);
    return processImageText(state, result?.data?.text || "");
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      await stopIMessageImageReader();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function stopIMessageImageReader() {
  const worker = await workerPromise;
  workerPromise = null;
  await worker?.terminate();
}
