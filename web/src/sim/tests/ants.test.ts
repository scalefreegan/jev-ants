import { test } from "node:test";
import assert from "node:assert/strict";
import { compass, createWorld, decide, headingOf, occupancy, step } from "../ants.ts";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("createWorld scatters inside the grid and everyone is due", () => {
  const w = createWorld({ w: 10, h: 5 }, 50, seeded(1));
  for (let i = 0; i < w.n; i++) {
    assert.ok((w.x[i] as number) >= 0 && (w.x[i] as number) < 10);
    assert.ok((w.y[i] as number) >= 0 && (w.y[i] as number) < 5);
    assert.equal(w.settled[i], 0);
  }
  assert.equal(step(w, 0.016), 50);
  assert.equal(occupancy(w).reduce((a, b) => a + b, 0), 50);
});

test("step walks along the heading, burns commit, bounces at the border, and leaves settled ants alone", () => {
  const w = createWorld({ w: 10, h: 10 }, 2, seeded(2));
  decide(w, 1, 0, 0, 0, true, 0, 1); // park ant 1 so only ant 0 can be due
  w.x[0] = 5;
  w.y[0] = 5;
  decide(w, 0, 0, 2, 1, false, 0, 1); // east at 2 cells/s, commit 1 cell
  assert.equal(step(w, 0.25), 0);
  assert.ok(Math.abs((w.x[0] as number) - 5.5) < 1e-5);
  assert.equal(step(w, 0.25), 1); // commit exhausted → due
  assert.equal(w.pace[0], 1.5, "a due ant coasts at its coast pace until the next decision");
  decide(w, 0, 0, 2, 0.1, false, 0, 2, 0);
  step(w, 0.25);
  assert.equal(w.pace[0], 0, "coast 0: the ant stops where it was sent");
  // bounce
  w.x[0] = 9.9;
  decide(w, 0, 0, 10, 100, false, 0, 1);
  step(w, 0.1);
  assert.ok((w.x[0] as number) <= 10);
  assert.ok(Math.cos(w.heading[0] as number) < 0, "heading flipped to west");
  // settled: pace and commit are ignored, the ant stays put
  w.x[1] = 3;
  w.y[1] = 3;
  decide(w, 1, 0, 5, 5, true, 0, 1);
  step(w, 1);
  assert.equal(w.x[1], 3);
  assert.equal(w.pace[1], 0);
});

test("compass names and headings round-trip in screen coordinates", () => {
  assert.equal(compass(0), "E");
  assert.equal(compass(Math.PI / 2), "S");
  assert.equal(compass(-Math.PI / 2), "N");
  assert.equal(compass(Math.PI), "W");
  for (const n of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) assert.equal(compass(headingOf(n)), n);
});
