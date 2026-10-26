// The target grid. A picture is a grid of "how many ants should stand here",
// normalised so the whole picture asks for exactly as many ants as exist.
// Everything here is pure typed-array arithmetic, no DOM.

export interface GridSize {
  w: number;
  h: number;
}

export const DEFAULT_GRID: GridSize = { w: 96, h: 64 };

/** Box-downsample an RGBA buffer to a darkness grid in 0..1 (1 = black). Alpha-weighted so transparent pixels count as paper. */
export function rgbaToDarkness(rgba: Uint8ClampedArray, srcW: number, srcH: number, size: GridSize): Float32Array {
  const out = new Float32Array(size.w * size.h);
  for (let gy = 0; gy < size.h; gy++) {
    const y0 = Math.floor((gy * srcH) / size.h);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * srcH) / size.h));
    for (let gx = 0; gx < size.w; gx++) {
      const x0 = Math.floor((gx * srcW) / size.w);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * srcW) / size.w));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * srcW + x) * 4;
          const lum = (0.2126 * (rgba[i] as number) + 0.7152 * (rgba[i + 1] as number) + 0.0722 * (rgba[i + 2] as number)) / 255;
          const a = (rgba[i + 3] as number) / 255;
          sum += (1 - lum) * a;
          count++;
        }
      }
      out[gy * size.w + gx] = count ? sum / count : 0;
    }
  }
  return out;
}

/**
 * Turn darkness (0..1 per cell) into a target ant count per cell that sums to
 * `antCount`. `gamma` > 1 deepens contrast (light greys ask for fewer ants);
 * `floor` drops faint noise so the paper stays clean. An all-white picture
 * returns zeros: there is nothing to form.
 */
export function normalizeTarget(darkness: Float32Array, antCount: number, gamma = 1.4, floor = 0.08): Float32Array {
  const out = new Float32Array(darkness.length);
  let sum = 0;
  for (let i = 0; i < darkness.length; i++) {
    const d = darkness[i] as number;
    const v = d < floor ? 0 : Math.pow(d, gamma);
    out[i] = v;
    sum += v;
  }
  if (sum <= 0) return out;
  const k = antCount / sum;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * k;
  return out;
}

/** max(target − occupancy, 0) per cell: only what is still wanted. Blurred, this is the field ants feel from afar — an ant's own presence must not mask a distant slope, so over-full cells contribute nothing here. */
export function wantGrid(target: Float32Array, occupancy: Uint16Array | Float32Array, out?: Float32Array): Float32Array {
  const d = out ?? new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) d[i] = Math.max(0, (target[i] as number) - (occupancy[i] as number));
  return d;
}

/** target − occupancy per cell: positive wants ants, negative has too many. */
export function deficitGrid(target: Float32Array, occupancy: Uint16Array | Float32Array, out?: Float32Array): Float32Array {
  const d = out ?? new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) d[i] = (target[i] as number) - (occupancy[i] as number);
  return d;
}

/**
 * Separable box blur, `passes` times (3 passes ≈ Gaussian). Sum-preserving,
 * edges clamp. Used to turn the sharp deficit grid into a field an ant can
 * feel from a distance: far from the picture the blurred deficit still
 * slopes toward it.
 */
export function blur(src: Float32Array, size: GridSize, radius: number, passes = 3): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const { w, h } = size;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -radius; x <= radius; x++) acc += a[row + clamp(x, 0, w - 1)] as number;
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * radius + 1);
        acc += (a[row + clamp(x + radius + 1, 0, w - 1)] as number) - (a[row + clamp(x - radius, 0, w - 1)] as number);
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += b[clamp(y, 0, h - 1) * w + x] as number;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * radius + 1);
        acc += (b[clamp(y + radius + 1, 0, h - 1) * w + x] as number) - (b[clamp(y - radius, 0, h - 1) * w + x] as number);
      }
    }
  }
  return a;
}

/** The 3×3 neighbourhood of cell (cx, cy), row-major NW..SE, edge cells clamped. */
export function neighbourhood3x3(grid: Float32Array, size: GridSize, cx: number, cy: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(9);
  let k = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const y = clamp(cy + dy, 0, size.h - 1);
    for (let dx = -1; dx <= 1; dx++) {
      const x = clamp(cx + dx, 0, size.w - 1);
      o[k++] = grid[y * size.w + x] as number;
    }
  }
  return o;
}

/**
 * How formed the picture is, 0..1. Per cell the error is |target − occupancy|
 * beyond half an ant: targets are fractional (1.6 ants per cell) and integer
 * occupancy can never match them exactly, so a cell within half an ant of
 * its target counts as right. Each misplaced ant is counted twice (missing
 * here, extra there), hence the 2N. With no target it is 0.
 */
export function coverage(target: Float32Array, occupancy: Uint16Array | Float32Array, antCount: number): number {
  if (antCount <= 0) return 0;
  let err = 0;
  let total = 0;
  for (let i = 0; i < target.length; i++) {
    err += Math.max(0, Math.abs((target[i] as number) - (occupancy[i] as number)) - 0.5);
    total += target[i] as number;
  }
  if (total <= 0) return 0;
  return Math.max(0, 1 - err / (2 * antCount));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
