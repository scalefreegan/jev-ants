import { test } from "node:test";
import assert from "node:assert/strict";
import { gradientHeading, shouldSettle } from "../local.ts";
import { compass } from "../ants.ts";

test("gradientHeading points at the wanting cells and is null on a flat field", () => {
  const north = new Float32Array([0, 3, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(compass(gradientHeading(north) as number), "N");
  const southEast = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 2]);
  assert.equal(compass(gradientHeading(southEast) as number), "SE");
  const flat = new Float32Array(9).fill(2);
  assert.equal(gradientHeading(flat), null);
  const centreIsPeak = new Float32Array([0, 0, 0, 0, 5, 0, 0, 0, 0]);
  assert.equal(gradientHeading(centreIsPeak), null);
  // uphill from a non-zero centre still points at the rise
  const slope = new Float32Array([1, 1, 1, 1, 1, 3, 1, 1, 1]);
  assert.equal(compass(gradientHeading(slope) as number), "E");
});

test("shouldSettle: the cell has room (deficit ≥ 0, with tolerance) → settle", () => {
  assert.equal(shouldSettle(1), true);
  assert.equal(shouldSettle(0), true);
  assert.equal(shouldSettle(-0.4), true);
  assert.equal(shouldSettle(-1), false);
});
