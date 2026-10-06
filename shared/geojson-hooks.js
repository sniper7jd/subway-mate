import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".geojson")) {
    return {
      format: "json",
      source: await readFile(new URL(url), "utf8"),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
