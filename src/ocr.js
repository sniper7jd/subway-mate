import { createWorker } from "tesseract.js";

let workerPromise;

export function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export async function readSignText(image) {
  const worker = await getWorker();
  const result = await worker.recognize(image);
  return result?.data?.text || "";
}
