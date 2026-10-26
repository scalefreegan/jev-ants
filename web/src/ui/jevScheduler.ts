import type { JevProxyReply, JevResponse, RunCaps, RunSummary } from "../../shared/jev.ts";
import type { Engine } from "../sim/engine.ts";
import { antState, applyDecision, calibration, packRequest, readDecision, type AntState, type Neutral, type Schema } from "../sim/jevBrain.ts";
import { boxArea, boxCentre, boxInkShare, buildOverseerRequest, readOverseer, type Box } from "../sim/overseer.ts";
import { overseerImages } from "./overseerImages.ts";
import type { JevAnswer } from "../../shared/jev.ts";

// Drives the Jev brain against the proxy. Every `intervalMs` it takes the
// stalest due ants that are at least `minAgeSeconds` past their last
// decision, packs them `batch` at a time, and keeps at most `inFlight`
// requests open. Ants with a request in flight keep walking on their last
// heading (commit is parked high so they are not picked twice). A reply
// becomes decisions; a failed call hands those ants to the local rule once.
// A 409 from the server means a cap fired (or the run was stopped): the
// scheduler goes idle and releases every ant to the local rule.

export interface SchedulerOptions {
  schema: Schema;
  batch: number;
  inFlight: number;
  intervalMs: number;
  minAgeSeconds: number;
  /** sample the compass choice from its probabilities instead of argmax */
  sample: boolean;
  /** the image overseer: on/off and how often it looks, ms */
  overseer: boolean;
  overseerMs: number;
}

export const DEFAULT_SCHEDULER: SchedulerOptions = { schema: "compass", batch: 100, inFlight: 6, intervalMs: 200, minAgeSeconds: 1.5, sample: false, overseer: true, overseerMs: 4000 };

export interface OverseerState {
  box: Box | null;
  /** did the box pass the sanity check and become the attractor */
  steering: boolean;
  done: number;
  inputTokens: number;
  ms: number;
  calls: number;
  /** tokens spent by the overseer this run */
  tokensThisRun: number;
  at: number;
}

export interface Sample {
  id: string;
  state: AntState;
  answers: Record<string, JevAnswer>;
  decision: { heading: string | null; settle: boolean; strength: number; pSettle: number } | null;
}

export interface SchedulerState {
  phase: "idle" | "running" | "stopped";
  run: RunSummary | null;
  pending: number;
  requestsSent: number;
  failures: number;
  lastError: string | null;
  sample: Sample | null;
  /** the last reply's neutral point (what Jev answers for an ant with nothing around it) */
  neutral: Neutral | null;
  overseer: OverseerState | null;
  /** engine.targetVersion when the last run ended */
  stoppedOnTarget: number;
  /** client-side running total across runs this page-load, dollars */
  sessionUsd: number;
  sessionTokens: number;
}

type Listener = (s: SchedulerState) => void;

export class JevScheduler {
  #engine: Engine;
  opts: SchedulerOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #overseerTimer: ReturnType<typeof setInterval> | null = null;
  #overseerBusy = false;
  #inFlight = 0;
  #pending: Uint8Array;
  #listeners = new Set<Listener>();
  #state: SchedulerState = { phase: "idle", run: null, pending: 0, requestsSent: 0, failures: 0, lastError: null, sample: null, neutral: null, overseer: null, stoppedOnTarget: 0, sessionUsd: 0, sessionTokens: 0 };
  #lastRunTokens = 0;
  #startedAt = 0;

  constructor(engine: Engine, opts: Partial<SchedulerOptions> = {}) {
    this.#engine = engine;
    this.opts = { ...DEFAULT_SCHEDULER, ...opts };
    this.#pending = new Uint8Array(engine.world.n);
  }

  get state(): SchedulerState {
    return this.#state;
  }

  setOptions(patch: Partial<SchedulerOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  #set(patch: Partial<SchedulerState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn(this.#state);
  }

  /** Start a run on the server and begin scheduling. */
  async start(caps: Partial<RunCaps>): Promise<void> {
    const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", caps }) });
    const run = (await res.json()) as RunSummary;
    if (!res.ok) {
      this.#set({ lastError: (run as unknown as { error?: string }).error ?? `start failed (${res.status})` });
      return;
    }
    this.#lastRunTokens = 0;
    this.#resizePending();
    this.#pending.fill(0);
    // A picture that is already half there (the local rule, or a previous run)
    // leaves Jev nothing to do: scatter so the run is a formation from scratch.
    if (this.#engine.coverage > 0.5) this.#engine.scatter();
    this.#engine.jevOwned.fill(1);
    this.#engine.params.brain = "jev";
    this.#startedAt = performance.now();
    this.#set({ phase: "running", run, lastError: null, requestsSent: 0, failures: 0, overseer: null });
    this.#engine.attractor = null;
    if (this.#timer === null) this.#timer = setInterval(() => void this.#cycle(), this.opts.intervalMs);
    if (this.#overseerTimer === null) this.#overseerTimer = setInterval(() => void this.#oversee(), this.opts.overseerMs);
  }

  /** Seconds since Start, for the "formed" rule. */
  get runSeconds(): number {
    return this.#state.phase === "running" ? (performance.now() - this.#startedAt) / 1000 : 0;
  }

  /** Stop: tell the server why, go idle, hand every ant back to the local rule. */
  async stop(reason: "user" | "formed" = "user"): Promise<void> {
    this.#halt();
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: reason === "formed" ? "formed" : "stop" }) });
      const run = (await res.json()) as RunSummary;
      this.#absorb(run);
      this.#set({ phase: "stopped", run });
    } catch (e) {
      this.#set({ phase: "stopped", lastError: String(e) });
    }
  }

  #halt(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#overseerTimer !== null) {
      clearInterval(this.#overseerTimer);
      this.#overseerTimer = null;
    }
    this.#engine.attractor = null;
    this.#set({ stoppedOnTarget: this.#engine.targetVersion });
    this.#engine.jevOwned.fill(0);
    // After a run the stragglers finish with the local rule, so a formed
    // picture stays formed without spending.
    this.#engine.idleBehaviour = "local";
    // Ants with a request in flight: let the local rule take them now; a late
    // reply is ignored because they are no longer pending.
    for (let i = 0; i < this.#pending.length; i++) {
      if (this.#pending[i]) {
        this.#pending[i] = 0;
        this.#engine.world.commit[i] = 0;
      }
    }
    this.#set({ pending: 0 });
  }

  dispose(): void {
    this.#halt();
    this.#listeners.clear();
  }

  #resizePending(): void {
    if (this.#pending.length !== this.#engine.world.n) this.#pending = new Uint8Array(this.#engine.world.n);
  }

  /** Accumulate the session total from a run summary (tokens are cumulative within a run). */
  #absorb(run: RunSummary): void {
    const delta = Math.max(0, run.inputTokens - this.#lastRunTokens);
    this.#lastRunTokens = run.inputTokens;
    this.#state.sessionTokens += delta;
    this.#state.sessionUsd = this.#state.sessionTokens * (0.042 / 1_000_000);
  }

  async #oversee(): Promise<void> {
    if (!this.opts.overseer || this.#state.phase !== "running" || this.#overseerBusy) return;
    const e = this.#engine;
    this.#overseerBusy = true;
    try {
      const images = await overseerImages(e.target, e.occupancy, e.params.size);
      const res = await fetch("/api/jev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildOverseerRequest(images.target, images.current)) });
      const body = (await res.json()) as JevProxyReply | { error: string; run?: RunSummary };
      if (res.status === 409) return; // the run ended; the ant loop handles the stop
      if (!res.ok) return; // busy or a server error: skip this look
      const reply = body as JevProxyReply;
      if (reply.status !== 200 || !reply.body || !("answers" in reply.body)) {
        this.#set({ lastError: `overseer: jev answered ${reply.status}` });
        return;
      }
      const reading = readOverseer((reply.body as JevResponse).answers);
      if (!reading) return;
      const steering = reading.box !== null && boxSteers(reading.box, e.target, e.params.size);
      e.attractor = steering && reading.box ? boxCentre(reading.box, e.params.size) : null;
      this.#absorb(reply.run);
      const prev = this.#state.overseer;
      this.#set({
        run: reply.run,
        overseer: { box: reading.box, steering, done: reading.done, inputTokens: reply.inputTokens, ms: reply.ms, calls: (prev?.calls ?? 0) + 1, tokensThisRun: (prev?.tokensThisRun ?? 0) + reply.inputTokens, at: performance.now() },
      });
    } catch (err) {
      this.#set({ lastError: `overseer: ${String(err)}` });
    } finally {
      this.#overseerBusy = false;
    }
  }

  async #cycle(): Promise<void> {
    if (this.#state.phase !== "running") return;
    this.#resizePending();
    const e = this.#engine;
    if (e.params.brain !== "jev") return;
    const minAge = this.opts.minAgeSeconds;
    const free = this.opts.inFlight - this.#inFlight;
    if (free <= 0) return;
    const due = e.dueAnts().filter((i) => !this.#pending[i] && e.time - (e.world.decidedAt[i] as number) >= minAge);
    if (due.length === 0) return;
    const batches = Math.min(free, Math.ceil(due.length / this.opts.batch));
    for (let b = 0; b < batches; b++) {
      const ids = due.slice(b * this.opts.batch, (b + 1) * this.opts.batch);
      void this.#send(ids);
    }
  }

  async #send(indices: number[]): Promise<void> {
    const e = this.#engine;
    const ants = indices.map((i) => ({ id: `a${i}`, state: antState(e, i) }));
    for (const i of indices) {
      this.#pending[i] = 1;
      e.world.commit[i] = 1e9; // keep walking, do not get picked again
    }
    this.#inFlight++;
    this.#set({ pending: this.#state.pending + indices.length, requestsSent: this.#state.requestsSent + 1 });
    let reply: JevProxyReply | null = null;
    let error: string | null = null;
    try {
      const res = await fetch("/api/jev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(packRequest(ants, this.opts.schema)) });
      const body = (await res.json()) as JevProxyReply | { error: string; run?: RunSummary };
      if (res.status === 409) {
        // A cap fired or the run was stopped elsewhere.
        const run = (body as { run?: RunSummary }).run ?? null;
        this.#inFlight--;
        this.#halt();
        if (run) this.#absorb(run);
        this.#set({ phase: "stopped", run, lastError: null });
        return;
      }
      if (res.status === 429 && (body as { error?: string }).error === "busy") {
        // The server's pool is full or the cap has no room for another worst-case
        // call right now: release these ants to be picked up next cycle, no fallback.
        this.#inFlight--;
        for (const i of indices) {
          if (this.#pending[i]) {
            this.#pending[i] = 0;
            e.world.commit[i] = 0;
          }
        }
        this.#set({ pending: Math.max(0, this.#state.pending - indices.length), run: (body as { run?: RunSummary }).run ?? this.#state.run });
        return;
      }
      if (!res.ok) error = (body as { error: string }).error ?? `HTTP ${res.status}`;
      else reply = body as JevProxyReply;
    } catch (err) {
      error = String(err);
    }
    this.#inFlight--;
    const stillPending = indices.filter((i) => this.#pending[i]);
    for (const i of stillPending) this.#pending[i] = 0;
    this.#set({ pending: Math.max(0, this.#state.pending - indices.length) });
    if (!reply || reply.status !== 200 || !reply.body || !("answers" in reply.body)) {
      const msg = error ?? `jev answered ${reply?.status ?? "?"}: ${JSON.stringify(reply?.body ?? "").slice(0, 120)}`;
      for (const i of stillPending) e.decideLocally(i);
      this.#set({ failures: this.#state.failures + 1, lastError: msg, run: reply?.run ?? this.#state.run });
      return;
    }
    const answers = (reply.body as JevResponse).answers;
    const neutral = calibration(answers);
    let sample: Sample | null = null;
    for (const a of ants) {
      const i = Number(a.id.slice(1));
      if (!stillPending.includes(i)) continue; // halted mid-flight
      const d = readDecision(answers, a.id, this.opts.schema, { sample: this.opts.sample, neutral });
      if (!d) {
        e.decideLocally(i);
        continue;
      }
      applyDecision(e, i, d, a.state);
      if (!sample) {
        const own: Record<string, JevAnswer> = {};
        for (const [k, v] of Object.entries(answers)) if (k.startsWith(`${a.id}_`)) own[k] = v;
        sample = { id: a.id, state: a.state, answers: own, decision: { heading: d.heading === null ? null : compassOf(d.heading), settle: d.settle, strength: d.strength, pSettle: d.pSettle } };
      }
    }
    this.#absorb(reply.run);
    this.#set({ run: reply.run, sample: sample ?? this.#state.sample, neutral, lastError: null });
  }
}

// The overseer's look: two PNGs, a box and a noul, through the same proxy and
// ledger as the ants. The box steers only when it is specific (under half the
// picture) and sits on ink the target actually asks for.
const OVERSEER_MAX_AREA = 0.5;
const OVERSEER_MIN_INK = 0.05;

export function boxSteers(box: Box, target: Float32Array, size: { w: number; h: number }): boolean {
  return boxArea(box) <= OVERSEER_MAX_AREA && boxInkShare(box, target, size) >= OVERSEER_MIN_INK;
}

function compassOf(h: number): string {
  const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const k = Math.round((((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[k] as string;
}
