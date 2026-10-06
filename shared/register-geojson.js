import { register } from "node:module";

await register("./geojson-hooks.js", import.meta.url);
