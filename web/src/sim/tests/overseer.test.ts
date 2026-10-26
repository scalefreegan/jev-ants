import { test } from "node:test";
import assert from "node:assert/strict";
import { boxArea, boxCentre, boxInkShare, buildOverseerRequest, readOverseer } from "../overseer.ts";

test("buildOverseerRequest: two image assets referenced from state, a box and a noul", () => {
  const r = buildOverseerRequest("AAAA", "BBBB");
  assert.deepEqual(Object.keys(r.assets ?? {}), ["img-target", "img-current"]);
  assert.equal(r.assets?.["img-target"]?.data_base64, "AAAA");
  assert.equal((r.state as { target: string }).target, "img-target");
  assert.equal(r.questions.gap?.type, "box");
  assert.equal(r.questions.done?.type, "noul");
});

test("readOverseer: tolerant of a missing or degenerate box, strict about done", () => {
  const good = readOverseer({ gap: { type: "box", box: { top: 0.2, bottom: 0.6, left: 0.1, right: 0.5 }, confidence: 0.4 }, done: { type: "noul", noul: 0.7 } });
  assert.deepEqual(good?.box, { top: 0.2, bottom: 0.6, left: 0.1, right: 0.5 });
  assert.equal(good?.done, 0.7);
  assert.equal(good?.boxConfidence, 0.4);
  const flat = readOverseer({ gap: { type: "box", box: { top: 0.5, bottom: 0.5, left: 0.1, right: 0.5 }, confidence: null }, done: { type: "noul", noul: 0.2 } });
  assert.equal(flat?.box, null);
  assert.equal(flat?.done, 0.2);
  assert.equal(readOverseer({ gap: { type: "box", box: { top: 0, bottom: 1, left: 0, right: 1 }, confidence: null } }), null);
  assert.equal(readOverseer({ done: { type: "noul", noul: 1.5 } }), null);
});

test("boxCentre, boxArea and boxInkShare in cell coordinates", () => {
  const size = { w: 10, h: 10 };
  const box = { top: 0, bottom: 0.5, left: 0, right: 0.5 };
  assert.deepEqual(boxCentre(box, size), { x: 2.5, y: 2.5 });
  assert.equal(boxArea(box), 0.25);
  const target = new Float32Array(100);
  target[0] = 1; // (0,0) inside
  target[99] = 3; // (9,9) outside
  assert.equal(boxInkShare(box, target, size), 0.25);
  assert.equal(boxInkShare(box, new Float32Array(100), size), 0);
});
