import type { JevAnswer, JevRequest } from "../../shared/jev.ts";
import { compass, decide, headingOf } from "./ants.ts";
import type { Engine } from "./engine.ts";
import { neighbourhood3x3 } from "./grid.ts";

// The Jev brain, pure: builds the packed request for a batch of ants and reads
// the answers back into decisions. Schema "nouls" (the bake-off winner, PRD
// §8.1b): three yes/no questions per ant — north-vs-south, east-vs-west,
// settle — read as a continuous heading. Schema "compass": a 9-way choice plus
// a settle noul, costlier but exact, kept for the comparison.

export type Schema = "nouls" | "compass";

export interface AntState {
  /** ants still needed in the 9 cells around the ant, NW..SE row-major, centre = own cell */
  deficit3x3: number[];
  /** whole ants of space left in the ant's own cell, counting this ant as already there: ≥ 0 means it may stay, < 0 means it is one too many. Rounded half-up so a fractional target (1.6 ants) holds two. */
  room: number;
  /** ants standing in those 9 cells, including this one */
  crowd: number;
  heading: string;
  nearbyHeadings: string[];
  /** seconds since this ant last decided */
  idle: number;
  /** direction where ants are wanted beyond the 9 cells, from the long-range field, or null */
  far: string | null;
  /** direction toward the overseer's box, or null */
  attractor: string | null;
}

export const LEGEND =
  "Each ant is one key in `ants`. room says whether the ant's own cell still has space for it: 0 or more means it may stay, negative means it is one too many and must move. deficit3x3 lists how many more ants each of the 9 cells around the ant still needs, row-major from north-west to south-east (NW N NE / W centre E / SW S SE); the centre is the ant's own cell; positive cells want ants, negative cells have too many. When no neighbouring cell wants ants, far is the direction where ants are wanted beyond view and attractor is where the overseer says the picture is emptiest: head that way. crowd is how many ants stand in those 9 cells. nearbyHeadings are the headings of ants next to this one.";

/**
 * Calibration: Jev's "no opinion" for a noul is nowhere near 0.5 (measured
 * 2026-10-25: flat ants answered north 0.06, east 0.19), so a heading read
 * against 0.5 drifts south-west. Every request carries a few ants with
 * nothing around them; their mean answers are the neutral point for that
 * request, and every other ant's answers are read relative to it.
 */
export const CALIBRATION_COUNT = 3;
export const CALIBRATION_PREFIX = "cal";
export const FLAT_STATE: AntState = { deficit3x3: [0, 0, 0, 0, -1, 0, 0, 0, 0], room: -1, crowd: 1, heading: "E", nearbyHeadings: [], idle: 2, far: null, attractor: null };

export interface Neutral {
  north: number;
  east: number;
  settle: number;
}
export const DEFAULT_NEUTRAL: Neutral = { north: 0.5, east: 0.5, settle: 0.5 };

const COMPASS_CRITERIA = {
  N: "step north",
  NE: "step north-east",
  E: "step east",
  SE: "step south-east",
  S: "step south",
  SW: "step south-west",
  W: "step west",
  NW: "step north-west",
  stay: "stay where it is: room is 0 or more",
};

export function antState(engine: Engine, i: number): AntState {
  const w = engine.world;
  const cx = Math.min(w.size.w - 1, Math.floor(w.x[i] as number));
  const cy = Math.min(w.size.h - 1, Math.floor(w.y[i] as number));
  const d = neighbourhood3x3(engine.deficit, w.size, cx, cy);
  let attractor: string | null = null;
  if (engine.attractor) {
    const dx = engine.attractor.x - (w.x[i] as number);
    const dy = engine.attractor.y - (w.y[i] as number);
    if (Math.hypot(dx, dy) > 2) attractor = compass(Math.atan2(dy, dx));
  }
  return {
    deficit3x3: Array.from(d, (v) => Math.round(v * 10) / 10),
    room: Math.floor((d[4] as number) + 0.5),
    crowd: engine.crowding(i),
    heading: compass(w.heading[i] as number),
    nearbyHeadings: engine.nearbyHeadings(i),
    idle: Math.round(Math.max(0, engine.time - (w.decidedAt[i] as number)) * 10) / 10,
    far: engine.farHint(i),
    attractor,
  };
}

export function questionsFor(id: string, schema: Schema): JevRequest["questions"] {
  if (schema === "compass") {
    return {
      [`${id}_dir`]: { type: "choice", instructions: `Which way should ant \`${id}\` step so the cells that still need ants get filled, avoiding crowding?`, criteria: COMPASS_CRITERIA },
      [`${id}_settle`]: { type: "noul", instructions: `${id}'s room is 0 or more, so its cell still has space and ${id} should stay.` },
    };
  }
  return {
    [`${id}_n`]: { type: "noul", instructions: `Going by deficit3x3 first, then far, then attractor: ${id} should head north rather than south (ignore east/west).` },
    [`${id}_e`]: { type: "noul", instructions: `Going by deficit3x3 first, then far, then attractor: ${id} should head east rather than west (ignore north/south).` },
    [`${id}_s`]: { type: "noul", instructions: `${id}'s room is 0 or more, so its cell still has space and ${id} should stay.` },
  };
}

/** Pack a batch plus the calibration ants (nouls only; the compass schema reads a choice, which needs none). */
export function packRequest(ants: { id: string; state: AntState }[], schema: Schema): JevRequest {
  const state: { legend: string; ants: Record<string, AntState> } = { legend: LEGEND, ants: {} };
  const questions: JevRequest["questions"] = {};
  const all = schema === "nouls" ? [...ants, ...Array.from({ length: CALIBRATION_COUNT }, (_, k) => ({ id: `${CALIBRATION_PREFIX}${k}`, state: FLAT_STATE }))] : ants;
  // Spread the calibration ants through the batch rather than at the end.
  for (let k = all.length - 1; k >= ants.length; k--) {
    const to = Math.floor(((k - ants.length + 1) * all.length) / (CALIBRATION_COUNT + 1));
    const [item] = all.splice(k, 1);
    all.splice(Math.min(to, k), 0, item as (typeof all)[number]);
  }
  for (const a of all) {
    state.ants[a.id] = a.state;
    Object.assign(questions, questionsFor(a.id, schema));
  }
  return { state, questions };
}

/** The neutral point from a reply's calibration ants; the default when they are missing. */
export function calibration(answers: Record<string, JevAnswer>): Neutral {
  const n: number[] = [];
  const e: number[] = [];
  const s: number[] = [];
  for (let k = 0; k < CALIBRATION_COUNT; k++) {
    const id = `${CALIBRATION_PREFIX}${k}`;
    const an = answers[`${id}_n`];
    const ae = answers[`${id}_e`];
    const as = answers[`${id}_s`];
    if (an?.type === "noul" && ae?.type === "noul" && as?.type === "noul") {
      n.push(an.noul);
      e.push(ae.noul);
      s.push(as.noul);
    }
  }
  if (n.length === 0) return DEFAULT_NEUTRAL;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { north: mean(n), east: mean(e), settle: mean(s) };
}

export interface AntDecision {
  /** radians, or null to keep the current heading */
  heading: number | null;
  settle: boolean;
  /** 0..1, how strongly Jev leaned */
  strength: number;
  /** P(settle) */
  pSettle: number;
}

/** Heading from the two axis probabilities read against the neutral point; null when Jev had no preference. Screen coordinates: north is −y. */
export function noulHeading(pNorth: number, pEast: number, neutral: Neutral = DEFAULT_NEUTRAL): { heading: number | null; strength: number } {
  const vx = pEast - neutral.east;
  const vy = -(pNorth - neutral.north);
  const mag = Math.hypot(vx, vy);
  if (mag < 0.08) return { heading: null, strength: 0 };
  return { heading: Math.atan2(vy, vx), strength: Math.min(1, mag / 0.5) };
}

/** Draw a key from a probability map; falls back to the argmax. */
export function sampleChoice(probabilities: Record<string, number>, rng: () => number): string {
  const entries = Object.entries(probabilities);
  let r = rng() * entries.reduce((a, [, p]) => a + p, 0);
  for (const [k, p] of entries) {
    r -= p;
    if (r <= 0) return k;
  }
  return entries.reduce((best, e) => (e[1] > best[1] ? e : best))[0];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read one ant's answers; null when they are missing or malformed (the caller falls back to the local rule). */
export function readDecision(answers: Record<string, JevAnswer>, id: string, schema: Schema, opts: { sample?: boolean; rng?: () => number; neutral?: Neutral } = {}): AntDecision | null {
  if (schema === "compass") {
    const dir = answers[`${id}_dir`];
    const settle = answers[`${id}_settle`];
    if (!dir || dir.type !== "choice" || !settle || settle.type !== "noul") return null;
    const pSettle = num(settle.noul) ?? 0;
    const pick = opts.sample && dir.probabilities ? sampleChoice(dir.probabilities, opts.rng ?? Math.random) : dir.choice;
    if (pick === "stay" || pSettle >= 0.5) return { heading: null, settle: true, strength: num(dir.confidence) ?? 0.5, pSettle };
    return { heading: headingOf(pick), settle: false, strength: num(dir.confidence) ?? 0.5, pSettle };
  }
  const n = answers[`${id}_n`];
  const e = answers[`${id}_e`];
  const s = answers[`${id}_s`];
  if (!n || n.type !== "noul" || !e || e.type !== "noul" || !s || s.type !== "noul") return null;
  const pN = num(n.noul);
  const pE = num(e.noul);
  const pSettle = num(s.noul);
  if (pN === null || pE === null || pSettle === null) return null;
  const neutral = opts.neutral ?? DEFAULT_NEUTRAL;
  // Settle when clearly above the neutral settle answer and above even odds.
  if (pSettle >= Math.max(0.5, neutral.settle + 0.25)) return { heading: null, settle: true, strength: 1, pSettle };
  const h = noulHeading(pN, pE, neutral);
  return { heading: h.heading, settle: false, strength: h.strength, pSettle };
}

/**
 * Write a decision into the world. Pace scales with how strongly Jev leaned.
 * Sent to a neighbouring cell that wants it, the ant walks there and stops to
 * wait for its next decision; on a far walk it commits further and keeps
 * drifting, so a stale heading never parks it in open paper.
 */
export function applyDecision(engine: Engine, i: number, d: AntDecision, state: AntState): void {
  const w = engine.world;
  const basePace = engine.params.local.pace;
  if (d.settle) {
    decide(w, i, w.heading[i] as number, 0, 0, true, engine.time, 2);
    engine.decisions.jev++;
    return;
  }
  const heading = d.heading ?? (w.heading[i] as number);
  const nearWant = state.deficit3x3.some((v, k) => k !== 4 && v > 0.3);
  const commit = nearWant ? 1.1 : 4;
  decide(w, i, heading, basePace * (0.5 + 0.5 * d.strength), commit, false, engine.time, 2, nearWant ? 0 : 1.5);
  engine.decisions.jev++;
}
