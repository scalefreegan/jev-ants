import type { GridSize } from "./grid.ts";
import { rgbaToDarkness } from "./grid.ts";

// Browser-only: turns text or an image into a darkness grid by drawing it on
// an offscreen canvas at several times the grid resolution and box-averaging
// down (rgbaToDarkness), so thin strokes become grey rather than vanishing.

const SCALE = 6;

function canvasFor(size: GridSize): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } {
  const w = size.w * SCALE;
  const h = size.h * SCALE;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D };
}

/** Render text (one or more lines) centred and as large as fits, black on white. */
export function textToDarkness(text: string, size: GridSize): Float32Array {
  const { canvas, ctx } = canvasFor(size);
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return new Float32Array(size.w * size.h);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  // Fit: start big, shrink until the widest line fits 90% of the width and all lines fit 85% of the height.
  let px = H / lines.length;
  for (let k = 0; k < 40; k++) {
    ctx.font = `bold ${px}px ${family}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const tall = px * 1.15 * lines.length;
    if (widest <= W * 0.9 && tall <= H * 0.85) break;
    px *= 0.9;
  }
  const lineH = px * 1.15;
  const y0 = H / 2 - (lineH * (lines.length - 1)) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lineH));
  const data = ctx.getImageData(0, 0, W, H).data;
  return rgbaToDarkness(data, W, H, size);
}

/** Draw an image contained and centred on white, then box-average to the grid. */
export function imageToDarkness(img: ImageBitmap | HTMLImageElement, size: GridSize): Float32Array {
  const { canvas, ctx } = canvasFor(size);
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const iw = img.width;
  const ih = img.height;
  const k = Math.min((W * 0.92) / iw, (H * 0.92) / ih);
  const dw = iw * k;
  const dh = ih * k;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const data = ctx.getImageData(0, 0, W, H).data;
  return rgbaToDarkness(data, W, H, size);
}
