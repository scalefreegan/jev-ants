import type { GridSize } from "../sim/grid.ts";

// Browser half of the overseer: draw a grid of values as a small greyscale
// PNG (paper white, ink black) and hand back base64. TypeSafe wants 280 to
// 1568 px per side, so the 96×64 grid is drawn at 5× (480×320). The target
// and the current field go through the same function with the same scale so
// the two pictures are comparable.

const SCALE = 5;

export function gridToPngBase64(values: Float32Array, size: GridSize, max: number): Promise<string> {
  const W = size.w * SCALE;
  const H = size.h * SCALE;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size.w, size.h);
  const px = img.data;
  for (let i = 0; i < values.length; i++) {
    const v = max > 0 ? Math.min(1, (values[i] as number) / max) : 0;
    const g = Math.round(255 * (1 - v));
    const o = i * 4;
    px[o] = g;
    px[o + 1] = g;
    px[o + 2] = g;
    px[o + 3] = 255;
  }
  const small = new OffscreenCanvas(size.w, size.h);
  small.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, W, H);
  return canvas.convertToBlob({ type: "image/png" }).then(async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
}

/** Both pictures on one scale: the target's densest cell is full ink in each. */
export async function overseerImages(target: Float32Array, occupancy: Uint16Array, size: GridSize): Promise<{ target: string; current: string }> {
  let max = 0;
  for (let i = 0; i < target.length; i++) max = Math.max(max, target[i] as number);
  const [t, c] = await Promise.all([gridToPngBase64(target, size, max), gridToPngBase64(Float32Array.from(occupancy), size, max)]);
  return { target: t, current: c };
}
