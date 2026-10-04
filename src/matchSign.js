const SIGNS = [
  { id: "downtown-brooklyn", src: "/signs/downtown-brooklyn.png" },
  { id: "uptown-bronx-123", src: "/signs/uptown-bronx-123.png" },
  { id: "uptown-bronx-1", src: "/signs/uptown-bronx-1.png" },
  { id: "one-train-uptown", src: "/signs/one-train-uptown.png" },
  { id: "seven-flushing", src: "/signs/seven-flushing.png" },
  { id: "seven-platform", src: "/signs/seven-platform.png" },
  { id: "nqrw", src: "/signs/nqrw.png" },
];

const GRID_X = 16;
const GRID_Y = 9;

function sample(source) {
  const canvas = document.createElement("canvas");
  canvas.width = GRID_X;
  canvas.height = GRID_Y;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, GRID_X, GRID_Y);
  const { data } = context.getImageData(0, 0, GRID_X, GRID_Y);
  const cells = [];
  for (let i = 0; i < data.length; i += 4) cells.push(data[i], data[i + 1], data[i + 2]);
  return cells;
}

function distance(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const delta = left[i] - right[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

let catalogPromise;

export function loadSignCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all(SIGNS.map((sign) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ id: sign.id, cells: sample(image) });
      image.onerror = () => reject(new Error(`Missing sign ${sign.src}`));
      image.src = sign.src;
    })));
  }
  return catalogPromise;
}

export async function matchSign(imageSource) {
  const catalog = await loadSignCatalog();
  const cells = sample(imageSource);
  const ranked = catalog
    .map((item) => ({ id: item.id, distance: distance(cells, item.cells) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  // Confident when the closest sign is at least 12% nearer than the runner-up.
  const confident = Boolean(second) && best.distance < second.distance * 0.88;
  return {
    id: confident ? best.id : null,
    distance: best?.distance ?? null,
    confident,
  };
}
