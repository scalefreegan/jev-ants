import type { GridSize } from "./grid.ts";
import { clamp } from "./grid.ts";

// The colony as structure-of-arrays: positions in cell units (0..w, 0..h),
// headings in radians (0 = east, π/2 = south — screen coordinates), pace in
// cells per second. A "decision" sets heading/pace/settled; `step` only
// integrates. Who decides (the local rule or Jev) lives elsewhere.

export interface World {
  size: GridSize;
  n: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  /** cells per second */
  pace: Float32Array;
  /** 1 = settled: holds its cell, does not walk */
  settled: Uint8Array;
  /** cells of travel left before the ant asks for a new decision */
  commit: Float32Array;
  /** cells/s to drift at once commit is spent, while waiting for the next decision (0 = stop and wait) */
  coast: Float32Array;
  /** sim-time (seconds) of the last decision, for staleness scheduling */
  decidedAt: Float32Array;
  /** who decided last: 0 none/wander, 1 local rule, 2 Jev */
  decidedBy: Uint8Array;
}

export function createWorld(size: GridSize, n: number, rng: () => number = Math.random): World {
  const w: World = {
    size,
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    heading: new Float32Array(n),
    pace: new Float32Array(n),
    settled: new Uint8Array(n),
    commit: new Float32Array(n),
    coast: new Float32Array(n),
    decidedAt: new Float32Array(n),
    decidedBy: new Uint8Array(n),
  };
  scatter(w, rng);
  return w;
}

/** Uniform random positions and headings; everyone unsettled and due for a decision. */
export function scatter(w: World, rng: () => number = Math.random): void {
  for (let i = 0; i < w.n; i++) {
    w.x[i] = rng() * w.size.w;
    w.y[i] = rng() * w.size.h;
    w.heading[i] = rng() * Math.PI * 2;
    w.pace[i] = 0;
    w.settled[i] = 0;
    w.commit[i] = 0;
    w.coast[i] = 0;
    w.decidedAt[i] = -1e9;
    w.decidedBy[i] = 0;
  }
}

export function cellOf(w: World, i: number): { cx: number; cy: number } {
  return { cx: clamp(Math.floor(w.x[i] as number), 0, w.size.w - 1), cy: clamp(Math.floor(w.y[i] as number), 0, w.size.h - 1) };
}

/** Ants per cell. */
export function occupancy(w: World, out?: Uint16Array): Uint16Array {
  const o = out ?? new Uint16Array(w.size.w * w.size.h);
  o.fill(0);
  for (let i = 0; i < w.n; i++) {
    const { cx, cy } = cellOf(w, i);
    o[cy * w.size.w + cx] = ((o[cy * w.size.w + cx] as number) + 1) as number;
  }
  return o;
}

/** default cells/s an ant drifts at once its commit distance is spent and it is waiting for a decision */
export const COAST_PACE = 1.5;

/**
 * Integrate one frame. Unsettled ants walk along their heading at their pace
 * and burn commit distance; at the border they turn back in. Settled ants do
 * not move. An ant whose commit is spent slows to its coast pace (0 = stop) so
 * it does not overshoot the cell it was sent to while it waits for the next
 * decision (the Jev cadence is ~1.5 s).
 * Returns how many ants are now due for a decision (commit ≤ 0 and not settled).
 */
export function step(w: World, dt: number): number {
  let due = 0;
  const maxX = w.size.w - 1e-3;
  const maxY = w.size.h - 1e-3;
  for (let i = 0; i < w.n; i++) {
    if (w.settled[i]) continue;
    const d = (w.pace[i] as number) * dt;
    if (d > 0) {
      let nx = (w.x[i] as number) + Math.cos(w.heading[i] as number) * d;
      let ny = (w.y[i] as number) + Math.sin(w.heading[i] as number) * d;
      if (nx < 0 || nx > maxX) {
        nx = clamp(nx, 0, maxX);
        w.heading[i] = Math.PI - (w.heading[i] as number);
      }
      if (ny < 0 || ny > maxY) {
        ny = clamp(ny, 0, maxY);
        w.heading[i] = -(w.heading[i] as number);
      }
      w.x[i] = nx;
      w.y[i] = ny;
      w.commit[i] = (w.commit[i] as number) - d;
    }
    if ((w.commit[i] as number) <= 0) {
      if ((w.pace[i] as number) > (w.coast[i] as number)) w.pace[i] = w.coast[i] as number;
      due++;
    }
  }
  return due;
}

/** Apply a decision: heading in radians, pace in cells/s, commit distance in cells, coast pace after that. */
export function decide(w: World, i: number, heading: number, pace: number, commit: number, settled: boolean, now: number, by: 0 | 1 | 2, coast = COAST_PACE): void {
  w.heading[i] = heading;
  w.pace[i] = settled ? 0 : pace;
  w.commit[i] = settled ? 0 : commit;
  w.coast[i] = settled ? 0 : coast;
  w.settled[i] = settled ? 1 : 0;
  w.decidedAt[i] = now;
  w.decidedBy[i] = by;
}

/** Compass name for a heading (screen coordinates: north is −y). */
export function compass(heading: number): string {
  const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const k = Math.round((((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[k] as string;
}

/** Heading in radians for a compass name. */
export function headingOf(name: string): number {
  const idx = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"].indexOf(name);
  return idx < 0 ? 0 : idx * (Math.PI / 4);
}
