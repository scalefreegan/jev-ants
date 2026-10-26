import { test } from "node:test";
import assert from "node:assert/strict";
import { CALIBRATION_COUNT, applyDecision, antState, calibration, noulHeading, packRequest, readDecision, sampleChoice, type AntState } from "../jevBrain.ts";
import { compass } from "../ants.ts";
import { Engine } from "../engine.ts";
import { normalizeTarget } from "../grid.ts";

const S: AntState = { deficit3x3: [0, 2, 0, 0, -1, 0, 0, 0, 0], room: -1, crowd: 3, heading: "E", nearbyHeadings: ["N"], idle: 1.2, far: null, attractor: null };

test("packRequest: one legend, one state per ant plus calibration ants, three noul questions each (two for compass, no calibration)", () => {
  const r = packRequest([{ id: "a0", state: S }, { id: "a1", state: S }], "nouls");
  assert.equal(Object.keys(r.questions).length, 3 * (2 + CALIBRATION_COUNT));
  assert.ok((r.state as { legend: string }).legend.includes("deficit3x3"));
  const ids = Object.keys((r.state as { ants: object }).ants);
  assert.deepEqual(ids.filter((k) => k.startsWith("a")), ["a0", "a1"]);
  assert.equal(ids.filter((k) => k.startsWith("cal")).length, CALIBRATION_COUNT);
  assert.notEqual(ids[0], "cal0", "calibration ants are spread through the batch, not all at one end");
  assert.equal(r.questions.a0_s?.type, "noul");
  const c = packRequest([{ id: "a0", state: S }], "compass");
  assert.equal(Object.keys(c.questions).length, 2);
  assert.equal(c.questions.a0_dir?.type, "choice");
});

test("calibration reads the neutral point and the heading is taken relative to it", () => {
  const answers = {
    cal0_n: { type: "noul" as const, noul: 0.06 }, cal0_e: { type: "noul" as const, noul: 0.2 }, cal0_s: { type: "noul" as const, noul: 0.04 },
    cal1_n: { type: "noul" as const, noul: 0.08 }, cal1_e: { type: "noul" as const, noul: 0.18 }, cal1_s: { type: "noul" as const, noul: 0.02 },
    cal2_n: { type: "noul" as const, noul: 0.07 }, cal2_e: { type: "noul" as const, noul: 0.19 }, cal2_s: { type: "noul" as const, noul: 0.03 },
    a0_n: { type: "noul" as const, noul: 0.07 }, a0_e: { type: "noul" as const, noul: 0.19 }, a0_s: { type: "noul" as const, noul: 0.03 },
    a1_n: { type: "noul" as const, noul: 0.32 }, a1_e: { type: "noul" as const, noul: 0.2 }, a1_s: { type: "noul" as const, noul: 0.04 },
  };
  const neutral = calibration(answers);
  assert.ok(Math.abs(neutral.north - 0.07) < 1e-9 && Math.abs(neutral.east - 0.19) < 1e-9);
  // a0 answers exactly like a flat ant: no preference, not south-west
  assert.equal(readDecision(answers, "a0", "nouls", { neutral })?.heading, null);
  assert.equal(compass(readDecision(answers, "a0", "nouls")?.heading as number), "SW", "without calibration the same answers drift south-west");
  // a1 leans north relative to neutral
  assert.equal(compass(readDecision(answers, "a1", "nouls", { neutral })?.heading as number), "N");
  assert.deepEqual(calibration({}), { north: 0.5, east: 0.5, settle: 0.5 });
});

test("noulHeading: north is −y, east is +x, no preference near 0.5/0.5", () => {
  assert.equal(compass(noulHeading(0.9, 0.5).heading as number), "N");
  assert.equal(compass(noulHeading(0.5, 0.9).heading as number), "E");
  assert.equal(compass(noulHeading(0.1, 0.1).heading as number), "SW");
  assert.equal(noulHeading(0.52, 0.49).heading, null);
  assert.ok(noulHeading(0.9, 0.5).strength > noulHeading(0.6, 0.5).strength);
});

test("readDecision (nouls): settle wins, else a heading; malformed answers → null", () => {
  const settle = readDecision({ a0_n: { type: "noul", noul: 0.9 }, a0_e: { type: "noul", noul: 0.5 }, a0_s: { type: "noul", noul: 0.8 } }, "a0", "nouls");
  assert.equal(settle?.settle, true);
  const go = readDecision({ a0_n: { type: "noul", noul: 0.9 }, a0_e: { type: "noul", noul: 0.5 }, a0_s: { type: "noul", noul: 0.2 } }, "a0", "nouls");
  assert.equal(go?.settle, false);
  assert.equal(compass(go?.heading as number), "N");
  assert.equal(readDecision({ a0_n: { type: "noul", noul: 0.9 } }, "a0", "nouls"), null);
  assert.equal(readDecision({ a0_n: { type: "noul", noul: Number.NaN }, a0_e: { type: "noul", noul: 0.5 }, a0_s: { type: "noul", noul: 0.2 } }, "a0", "nouls"), null);
});

test("readDecision (compass): argmax or sampled choice, stay settles", () => {
  const ans = { a0_dir: { type: "choice" as const, choice: "SE", confidence: 0.4, probabilities: { SE: 0.6, N: 0.4 } }, a0_settle: { type: "noul" as const, noul: 0.1 } };
  const d = readDecision(ans, "a0", "compass");
  assert.equal(compass(d?.heading as number), "SE");
  const sampled = readDecision(ans, "a0", "compass", { sample: true, rng: () => 0.99 });
  assert.equal(compass(sampled?.heading as number), "N");
  const stay = readDecision({ ...ans, a0_dir: { ...ans.a0_dir, choice: "stay" } }, "a0", "compass");
  assert.equal(stay?.settle, true);
  assert.equal(sampleChoice({ x: 0, y: 1 }, () => 0.5), "y");
});

test("antState reads the engine and applyDecision writes back with pace/commit rules", () => {
  const size = { w: 16, h: 16 };
  const e = new Engine({ size, antCount: 4, brain: "jev" }, () => 0.5);
  const dark = new Float32Array(size.w * size.h);
  dark[8 * 16 + 8] = 1;
  e.setTarget(normalizeTarget(dark, 4));
  e.world.x[0] = 8.5;
  e.world.y[0] = 9.5; // just south of the wanted cell
  e.refreshGrids();
  const st = antState(e, 0);
  assert.equal(st.deficit3x3.length, 9);
  assert.equal(st.room, Math.floor((st.deficit3x3[4] as number) + 0.5));
  // a cell wanting 1.6 that holds 2 ants is not over-full: room rounds half-up to 0
  e.target.fill(0);
  e.target[9 * 16 + 8] = 1.6;
  e.world.x[1] = 8.5;
  e.world.y[1] = 9.5;
  e.refreshGrids();
  assert.equal(antState(e, 0).room, 0);
  assert.equal(antState(e, 0).deficit3x3[4], -0.4);
  assert.ok((st.deficit3x3[1] as number) > 0, "the cell to the north wants ants");
  assert.ok(st.crowd >= 1);
  assert.equal(typeof st.far, "string");
  applyDecision(e, 0, { heading: -Math.PI / 2, settle: false, strength: 1, pSettle: 0.1 }, st);
  assert.equal(e.world.pace[0], e.params.local.pace);
  assert.ok(Math.abs((e.world.commit[0] as number) - 1.1) < 1e-6);
  assert.equal(e.world.coast[0], 0, "sent next door: stop on arrival");
  assert.equal(e.world.decidedBy[0], 2);
  assert.equal(e.decisions.jev, 1);
  applyDecision(e, 1, { heading: 0, settle: false, strength: 0, pSettle: 0.1 }, { ...st, deficit3x3: [0, 0, 0, 0, -1, 0, 0, 0, 0] });
  assert.equal(e.world.commit[1], 4);
  assert.equal(e.world.coast[1], 1.5, "far walk: keep drifting");
  assert.equal(e.world.pace[1], e.params.local.pace * 0.5);
  applyDecision(e, 2, { heading: null, settle: true, strength: 1, pSettle: 0.9 }, st);
  assert.equal(e.world.settled[2], 1);
  e.attractor = { x: 15, y: 9.5 };
  assert.equal(antState(e, 0).attractor, "E");
});
