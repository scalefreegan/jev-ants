import type { World } from "./ants.ts";
import { createWorld, decide, occupancy, scatter, step } from "./ants.ts";
import type { GridSize } from "./grid.ts";
import { blur, coverage, deficitGrid, wantGrid } from "./grid.ts";
import { DEFAULT_LOCAL, gradientHeading, localDecide, localView, type LocalParams } from "./local.ts";
import { compass } from "./ants.ts";

// The simulation, headless. One instance owns the world, the target and the
// derived grids; the renderer reads them, the brains write decisions. `tick`
// is the only mutation per frame. The Jev brain (milestone 3) consumes
// `dueAnts()` and calls `decide` itself; here the local rule covers everyone.

export type Brain = "local" | "jev";
/** What jev-mode ants do when no Jev run owns them: drift about (before Start) or finish with the local rule (after a stop). */
export type IdleBehaviour = "wander" | "local";

export interface EngineParams {
  size: GridSize;
  antCount: number;
  /** multiplier on walking pace */
  speed: number;
  brain: Brain;
  /** blur radius for the long-range field, in cells */
  fieldRadius: number;
  /** coverage at which the picture counts as formed */
  formedAt: number;
  local: LocalParams;
}

export const DEFAULT_PARAMS: EngineParams = {
  size: { w: 96, h: 64 },
  antCount: 1000,
  speed: 1,
  brain: "local",
  fieldRadius: 6,
  formedAt: 0.82,
  local: DEFAULT_LOCAL,
};

export interface EngineStats {
  time: number;
  coverage: number;
  formed: boolean;
  settled: number;
  due: number;
  decisions: { local: number; jev: number };
}

export class Engine {
  params: EngineParams;
  world: World;
  target: Float32Array;
  occupancy: Uint16Array;
  deficit: Float32Array;
  /** blurred want: what ants feel from a distance */
  field: Float32Array;
  #want: Float32Array;
  /** sim seconds */
  time = 0;
  formed = false;
  /** coverage from the last tick */
  coverage = 0;
  idleBehaviour: IdleBehaviour = "wander";
  decisions = { local: 0, jev: 0 };
  #scratch = new Float32Array(9);
  #scratch2 = new Float32Array(9);
  #rng: () => number;
  /** Per-ant override: when true the Jev brain owns this ant's next decision. */
  jevOwned: Uint8Array;
  /** Where the overseer says ants are most wanted (cell coordinates), or null. */
  attractor: { x: number; y: number } | null = null;
  // Cell → ants index (linked list), rebuilt with the grids, for neighbour queries.
  #cellHead: Int32Array;
  #next: Int32Array;

  constructor(params: Partial<EngineParams> = {}, rng: () => number = Math.random) {
    this.params = { ...DEFAULT_PARAMS, ...params, local: { ...DEFAULT_LOCAL, ...(params.local ?? {}) } };
    this.#rng = rng;
    const cells = this.params.size.w * this.params.size.h;
    this.world = createWorld(this.params.size, this.params.antCount, rng);
    this.target = new Float32Array(cells);
    this.occupancy = new Uint16Array(cells);
    this.deficit = new Float32Array(cells);
    this.#want = new Float32Array(cells);
    this.field = new Float32Array(cells);
    this.jevOwned = new Uint8Array(this.params.antCount);
    this.#cellHead = new Int32Array(cells);
    this.#next = new Int32Array(this.params.antCount);
    this.refreshGrids();
  }

  /** Replace the picture. Everyone wakes up (settled ants re-evaluate) but nobody moves yet. */
  setTarget(target: Float32Array): void {
    if (target.length !== this.target.length) throw new Error("target does not match the grid");
    this.target = target;
    this.formed = false;
    for (let i = 0; i < this.world.n; i++) {
      this.world.settled[i] = 0;
      this.world.commit[i] = 0;
    }
    this.refreshGrids();
  }

  setAntCount(n: number): void {
    if (n === this.world.n) return;
    const scale = n / Math.max(1, this.world.n);
    for (let i = 0; i < this.target.length; i++) this.target[i] = (this.target[i] as number) * scale;
    this.world = createWorld(this.params.size, n, this.#rng);
    this.params.antCount = n;
    this.jevOwned = new Uint8Array(n);
    this.#next = new Int32Array(n);
    this.formed = false;
    this.refreshGrids();
  }

  scatter(): void {
    scatter(this.world, this.#rng);
    this.formed = false;
    this.refreshGrids();
  }

  refreshGrids(): void {
    occupancy(this.world, this.occupancy);
    deficitGrid(this.target, this.occupancy, this.deficit);
    wantGrid(this.target, this.occupancy, this.#want);
    // Two scales: a wide blur of what is still wanted pulls ants in from
    // anywhere; a tight blur of the signed deficit pushes them off piles. One
    // wide blur alone peaks at the picture's centroid and every unsettled ant
    // walks there and stacks (measured: 80 ants in one cell).
    const far = blur(this.#want, this.params.size, this.params.fieldRadius);
    const near = blur(this.deficit, this.params.size, 1, 2);
    for (let i = 0; i < far.length; i++) far[i] = (far[i] as number) + (near[i] as number);
    this.field = far;
    // cell index
    this.#cellHead.fill(-1);
    const w = this.world;
    for (let i = 0; i < w.n; i++) {
      const cx = Math.min(w.size.w - 1, Math.floor(w.x[i] as number));
      const cy = Math.min(w.size.h - 1, Math.floor(w.y[i] as number));
      const c = cy * w.size.w + cx;
      this.#next[i] = this.#cellHead[c] as number;
      this.#cellHead[c] = i;
    }
  }

  /** Compass headings of up to `max` other ants in the 3×3 cells around ant i. */
  nearbyHeadings(i: number, max = 3): string[] {
    const w = this.world;
    const cx = Math.min(w.size.w - 1, Math.floor(w.x[i] as number));
    const cy = Math.min(w.size.h - 1, Math.floor(w.y[i] as number));
    const out: string[] = [];
    for (let dy = -1; dy <= 1 && out.length < max; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= w.size.h) continue;
      for (let dx = -1; dx <= 1 && out.length < max; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w.size.w) continue;
        for (let j = this.#cellHead[y * w.size.w + x] as number; j !== -1 && out.length < max; j = this.#next[j] as number) {
          if (j !== i) out.push(compass(w.heading[j] as number));
        }
      }
    }
    return out;
  }

  /** Ants in the 3×3 cells around ant i, including itself. */
  crowding(i: number): number {
    const w = this.world;
    const cx = Math.min(w.size.w - 1, Math.floor(w.x[i] as number));
    const cy = Math.min(w.size.h - 1, Math.floor(w.y[i] as number));
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= w.size.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w.size.w) continue;
        n += this.occupancy[y * w.size.w + x] as number;
      }
    }
    return n;
  }

  /** The direction the long-range field rises in around ant i, as a compass name, or null when flat. */
  farHint(i: number): string | null {
    const view = localView(this.world, i, this.field, this.deficit, this.params.size, this.#scratch, this.#scratch2);
    const g = gradientHeading(view.field);
    return g === null ? null : compass(g);
  }

  /** An aimless drift: a turn, a slow pace, a few cells, no settling. What jev-mode ants do before Start. */
  #wander(i: number): void {
    const w = this.world;
    const pace = this.params.local.pace * 0.25;
    decide(w, i, (w.heading[i] as number) + (this.#rng() - 0.5) * (Math.PI / 2), pace, 3, false, this.time, 0, pace);
  }

  /** The local rule decides for ant i right now (the Jev brain's fallback when a call fails). */
  decideLocally(i: number): void {
    const view = localView(this.world, i, this.field, this.deficit, this.params.size, this.#scratch, this.#scratch2);
    localDecide(this.world, i, view, this.params.local, this.time, this.#rng);
    this.decisions.local++;
  }

  /** Indices of ants whose commit ran out and are not settled, oldest decision first. */
  dueAnts(limit = Infinity): number[] {
    const w = this.world;
    const due: number[] = [];
    for (let i = 0; i < w.n; i++) if (!w.settled[i] && (w.commit[i] as number) <= 0) due.push(i);
    due.sort((a, b) => (w.decidedAt[a] as number) - (w.decidedAt[b] as number));
    return due.length > limit ? due.slice(0, limit) : due;
  }

  /**
   * Settled ants whose cell has since become over-full should get up. Called
   * each tick; cheap. Only the local rule does this for its own ants — the
   * Jev brain decides when to re-ask its settled ants.
   */
  wakeOverfull(): number {
    const w = this.world;
    let woke = 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.settled[i]) continue;
      const cx = Math.min(w.size.w - 1, Math.floor(w.x[i] as number));
      const cy = Math.min(w.size.h - 1, Math.floor(w.y[i] as number));
      if ((this.deficit[cy * w.size.w + cx] as number) < -1) {
        w.settled[i] = 0;
        w.commit[i] = 0;
        woke++;
      }
    }
    return woke;
  }

  /** Advance the sim by dt seconds. The local rule decides for every due ant it owns. */
  tick(dt: number): EngineStats {
    const p = this.params;
    this.time += dt;
    step(this.world, dt * p.speed);
    this.refreshGrids();
    this.wakeOverfull();
    const due = this.dueAnts();
    let left = 0;
    for (const i of due) {
      if (p.brain === "jev") {
        if (this.jevOwned[i]) {
          left++;
          continue;
        }
        if (this.idleBehaviour === "wander") {
          this.#wander(i);
          continue;
        }
      }
      const view = localView(this.world, i, this.field, this.deficit, p.size, this.#scratch, this.#scratch2);
      localDecide(this.world, i, view, { ...p.local, pace: p.local.pace }, this.time, this.#rng);
      this.decisions.local++;
    }
    const cov = coverage(this.target, this.occupancy, this.world.n);
    this.coverage = cov;
    if (cov >= p.formedAt) this.formed = true;
    else if (cov < p.formedAt - 0.1) this.formed = false;
    let settled = 0;
    for (let i = 0; i < this.world.n; i++) settled += this.world.settled[i] as number;
    return { time: this.time, coverage: cov, formed: this.formed, settled, due: left, decisions: { ...this.decisions } };
  }
}
