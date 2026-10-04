import { createWorker, OEM, PSM } from "tesseract.js";
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import languageUrl from "../eng.traineddata?url";

const MAX_IMAGE_EDGE = 1280;
const WORKER_TIMEOUT_MS = 20_000;
const OCR_TIMEOUT_MS = 15_000;
const languagePath = new URL(".", new URL(languageUrl, import.meta.url)).href.replace(/\/$/, "");
let workerPromise;
let activeWorker;
let progressListener;
let workerGeneration = 0;

export function getWorker(onProgress) {
  progressListener = onProgress;
  if (!workerPromise) {
    const generation = ++workerGeneration;
    let timeout;
    const initializing = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: workerUrl,
      corePath: coreUrl,
      langPath: languagePath,
      gzip: false,
      cacheMethod: "write",
      logger: (message) => progressListener?.(message),
    }).then(async (worker) => {
      if (generation !== workerGeneration) {
        await worker.terminate();
        throw new Error("The sign reader was restarted.");
      }
      activeWorker = worker;
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      return worker;
    });
    workerPromise = Promise.race([
      initializing,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("The local sign reader took too long to start.")),
          WORKER_TIMEOUT_MS,
        );
      }),
    ]).catch((error) => {
      if (generation === workerGeneration) {
        workerGeneration += 1;
        workerPromise = null;
        const worker = activeWorker;
        activeWorker = null;
        if (worker) void worker.terminate().catch(console.error);
      }
      throw error;
    }).finally(() => clearTimeout(timeout));
  }
  return workerPromise;
}

export async function warmSignReader(onProgress) {
  await getWorker(onProgress);
}

export async function stopSignReader() {
  workerGeneration += 1;
  const worker = activeWorker;
  activeWorker = null;
  workerPromise = null;
  if (worker) await worker.terminate();
}

async function prepareImage(image) {
  const bitmap = await createImageBitmap(image, { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new Error("This image is too large to read safely. Choose a smaller photo.");
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare this image for local text reading.");
    context.filter = "grayscale(1) contrast(1.12)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function readSignText(image, onProgress) {
  const preparedImage = await prepareImage(image);
  const worker = await getWorker(onProgress);
  let timeout;
  try {
    const result = await Promise.race([
      worker.recognize(preparedImage, {}, { text: true }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("The sign reader timed out. Try a closer, clearer photo.")), OCR_TIMEOUT_MS);
      }),
    ]);
    return {
      text: result?.data?.text?.trim() || "",
      confidence: Number.isFinite(result?.data?.confidence) ? result.data.confidence : null,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      await stopSignReader();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
