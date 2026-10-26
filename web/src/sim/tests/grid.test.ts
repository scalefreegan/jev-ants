import { test } from "node:test";
import assert from "node:assert/strict";
import { blur, coverage, deficitGrid, neighbourhood3x3, normalizeTarget, rgbaToDarkness } from "../grid.ts";

test("rgbaToDarkness: black opaque = 1, white = 0, transparent = 0, box-averaged", () => {
  // 4×2 source → 2×1 grid. Left half black, right half white but half transparent.
  const px = new Uint8ClampedArray(4 * 2 * 4);
  for (let i = 0; i < 8; i++) {
    const x = i % 4;
    const o = i * 4;
    if (x < 2) px.set([0, 0, 0, 255], o);
    else px.set([255, 255, 255, 128], o);
  }
  const d = rgbaToDarkness(px, 4, 2, { w: 2, h: 1 });
  assert.ok(Math.abs((d[0] as number) - 1) < 1e-6);
  assert.ok(Math.abs(d[1] as number) < 1e-6);
  // a 50% grey opaque pixel is ~0.5 dark
  const grey = new Uint8ClampedArray([128, 128, 128, 255]);
  assert.ok(Math.abs((rgbaToDarkness(grey, 1, 1, { w: 1, h: 1 })[0] as number) - 0.498) < 0.01);
});

test("normalizeTarget sums to the ant count, floors faint cells, and is all-zero for blank paper", () => {
  const dark = new Float32Array([1, 0.5, 0.02, 0]);
  const t = normalizeTarget(dark, 300, 1, 0.08);
  const sum = t.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 300) < 1e-3);
  assert.equal(t[2], 0);
  assert.equal(t[3], 0);
  assert.ok((t[0] as number) > (t[1] as number));
  assert.deepEqual(Array.from(normalizeTarget(new Float32Array(4), 100)), [0, 0, 0, 0]);
});

test("deficitGrid and coverage: perfect placement is 1, within half an ant is perfect, wrong places score low", () => {
  const target = new Float32Array([2, 0, 0, 2]);
  assert.equal(coverage(target, new Uint16Array([2, 0, 0, 2]), 4), 1);
  assert.ok(coverage(new Float32Array([1.6, 1.6, 0.8]), new Uint16Array([2, 1, 1]), 4) > 0.98);
  assert.equal(coverage(target, new Uint16Array([0, 2, 2, 0]), 4), 0.25);
  assert.ok(Math.abs(coverage(target, new Uint16Array([2, 0, 2, 0]), 4) - 0.625) < 1e-6);
  assert.deepEqual(Array.from(deficitGrid(target, new Uint16Array([1, 1, 0, 3]))), [1, -1, 0, -1]);
  assert.equal(coverage(new Float32Array(4), new Uint16Array(4), 4), 0);
});

test("blur preserves the total and slopes toward the mass", () => {
  const size = { w: 9, h: 1 };
  const src = new Float32Array(9);
  src[4] = 9;
  const b = blur(src, size, 1, 2);
  assert.ok(Math.abs(b.reduce((a, c) => a + c, 0) - 9) < 1e-4);
  assert.ok((b[4] as number) > (b[3] as number) && (b[3] as number) > (b[2] as number) && (b[2] as number) > (b[1] as number));
  assert.ok((b[0] as number) >= 0);
});

test("neighbourhood3x3 is row-major NW..SE with clamped edges", () => {
  const size = { w: 3, h: 3 };
  const g = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(Array.from(neighbourhood3x3(g, size, 1, 1)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(Array.from(neighbourhood3x3(g, size, 0, 0)), [1, 1, 2, 1, 1, 2, 4, 4, 5]);
});
