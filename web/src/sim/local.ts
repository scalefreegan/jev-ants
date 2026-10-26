import type { World } from "./ants.ts";
import { cellOf, decide } from "./ants.ts";
import type { GridSize } from "./grid.ts";
import { neighbourhood3x3 } from "./grid.ts";

// The greedy local rule: the baseline the Jev brain is compared against, and
// the fallback when Jev is paused. An ant looks at the raw deficit of the
// cells around it and at a smoothed long-range field, steps into a
// neighbouring cell that wants an ant, otherwise climbs the field, and
// settles when its own cell still wants it. Nothing here knows about the
// picture as a whole.

export interface LocalParams {
  /** cells/s when walking */
  pace: number;
  /** heading noise, radians (uniform ±) */
  noise: number;
  /** how far to commit before looking again, in cells */
  commit: number;
}

export const DEFAULT_LOCAL: LocalParams = { pace: 8, noise: 0.35, commit: 1.5 };

// Unit offsets for the 3×3 neighbourhood, row-major NW..SE; the centre is zero.
const DX = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 0, 1, 1, 1];

export interface LocalView {
  /** the long-range field (wide blur of want + tight blur of signed deficit), 3×3 NW..SE */
  field: Float32Array;
  /** raw deficit, 3×3 NW..SE; the centre counts the ant itself */
  deficit: Float32Array;
  /** raw deficit of the ant's own cell */
  own: number;
}

export function localView(
  w: World,
  i: number,
  field: Float32Array,
  deficit: Float32Array,
  size: GridSize,
  scratch?: Float32Array,
  scratch2?: Float32Array,
): LocalView {
  const { cx, cy } = cellOf(w, i);
  const d = neighbourhood3x3(deficit, size, cx, cy, scratch2);
  return { field: neighbourhood3x3(field, size, cx, cy, scratch), deficit: d, own: d[4] as number };
}

/**
 * Should this ant settle? Its own cell's raw deficit counts the ant itself,
 * so deficit ≥ 0 means the cell still has room for it. A small tolerance
 * stops ants on cells that are over by less than one ant from all leaving at once.
 */
export function shouldSettle(own: number): boolean {
  return own >= -0.5;
}

/** Heading to the neighbouring cell (not the centre) that most wants an ant, if any wants more than min. */
export function bestNeighbour(deficit: Float32Array, min = 0.3): number | null {
  let best = -1;
  let bestV = min;
  for (let k = 0; k < 9; k++) {
    if (k === 4) continue;
    const v = deficit[k] as number;
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best < 0 ? null : Math.atan2(DY[best] as number, DX[best] as number);
}

/** Heading up the slope of the field (toward neighbours that want more than here); null when the field is flat or the centre is the peak. */
export function gradientHeading(field: Float32Array): number | null {
  let vx = 0;
  let vy = 0;
  const c = field[4] as number;
  for (let k = 0; k < 9; k++) {
    if (k === 4) continue;
    const rise = (field[k] as number) - c;
    if (rise <= 1e-6) continue;
    const len = Math.hypot(DX[k] as number, DY[k] as number);
    vx += ((DX[k] as number) / len) * rise;
    vy += ((DY[k] as number) / len) * rise;
  }
  if (vx === 0 && vy === 0) return null;
  return Math.atan2(vy, vx);
}

/** Decide for one ant with the local rule. */
export function localDecide(w: World, i: number, view: LocalView, p: LocalParams, now: number, rng: () => number = Math.random): void {
  if (shouldSettle(view.own)) {
    decide(w, i, w.heading[i] as number, 0, 0, true, now, 1);
    return;
  }
  // A neighbouring cell that wants an ant beats everything: step into it.
  const near = bestNeighbour(view.deficit);
  if (near !== null) {
    decide(w, i, near + (rng() - 0.5) * p.noise, p.pace, 1, false, now, 1);
    return;
  }
  const g = gradientHeading(view.field);
  const heading = g === null ? (w.heading[i] as number) + (rng() - 0.5) * Math.PI : g + (rng() - 0.5) * 2 * p.noise;
  // Nothing nearby wants ants: stride further before looking again.
  decide(w, i, heading, p.pace, g === null ? p.commit * 2 : p.commit, false, now, 1);
}
