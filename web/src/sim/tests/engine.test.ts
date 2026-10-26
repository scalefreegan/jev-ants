import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../engine.ts";
import { normalizeTarget } from "../grid.ts";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A filled rectangle in the middle of the grid as darkness. */
function rectDarkness(w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.7); y++) for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) d[y * w + x] = 1;
  return d;
}

test("the local rule alone forms a rectangle from scattered ants (headless, seeded)", () => {
  const size = { w: 48, h: 32 };
  const n = 400;
  const e = new Engine({ size, antCount: n, brain: "local" }, seeded(7));
  e.setTarget(normalizeTarget(rectDarkness(size.w, size.h), n));
  const before = e.tick(1 / 60).coverage;
  let stats = e.tick(1 / 60);
  for (let i = 0; i < 60 * 40; i++) stats = e.tick(1 / 60); // 40 sim-seconds
  assert.ok(stats.coverage > before + 0.3, `coverage went ${before.toFixed(2)} → ${stats.coverage.toFixed(2)}`);
  assert.ok(stats.coverage > 0.85, `expected a mostly formed rectangle, got ${stats.coverage.toFixed(2)}`);
  assert.ok(stats.settled > n * 0.6, `expected most ants settled, got ${stats.settled}`);
  assert.equal(stats.decisions.jev, 0);
});

test("setTarget wakes everyone; scatter unforms; a blank target forms nothing", () => {
  const size = { w: 24, h: 16 };
  const e = new Engine({ size, antCount: 100 }, seeded(3));
  e.setTarget(normalizeTarget(rectDarkness(size.w, size.h), 100));
  for (let i = 0; i < 60 * 20; i++) e.tick(1 / 60);
  const formedCov = e.tick(1 / 60).coverage;
  assert.ok(formedCov > 0.6);
  e.scatter();
  const afterScatter = e.tick(1 / 60).coverage;
  assert.ok(afterScatter < formedCov - 0.2);
  e.setTarget(new Float32Array(size.w * size.h));
  for (let i = 0; i < 60; i++) e.tick(1 / 60);
  const s = e.tick(1 / 60);
  assert.equal(s.coverage, 0);
  assert.equal(s.formed, false);
});

test("in jev mode the engine leaves jev-owned due ants alone and counts them", () => {
  const size = { w: 24, h: 16 };
  const e = new Engine({ size, antCount: 10, brain: "jev" }, seeded(5));
  e.setTarget(normalizeTarget(rectDarkness(size.w, size.h), 10));
  e.jevOwned.fill(1);
  const s = e.tick(1 / 60);
  assert.equal(s.due, 10);
  assert.equal(s.decisions.local, 0);
  e.jevOwned.fill(0);
  const s2 = e.tick(1 / 60);
  assert.equal(s2.due, 0);
  assert.equal(s2.decisions.local, 10);
});
