import type { RunCaps } from "../../shared/jev.ts";
import type { Schema } from "../sim/jevBrain.ts";
import type { SchedulerState } from "./jevScheduler.ts";

interface Props {
  state: SchedulerState;
  caps: RunCaps;
  setCaps: (c: RunCaps) => void;
  schema: Schema;
  setSchema: (s: Schema) => void;
  start: () => void;
  stop: () => void;
  stopOnFormed: boolean;
  setStopOnFormed: (v: boolean) => void;
  overseer: boolean;
  setOverseer: (v: boolean) => void;
  activeAnts: number;
  jevDecisions: number;
}

const usd = (v: number) => `$${v.toFixed(4)}`;

export default function JevPanel(p: Props) {
  const run = p.state.run;
  const running = p.state.phase === "running";
  const stopped = p.state.phase === "stopped";
  const reason = run?.stopReason;
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-3">Jev</h2>
        <span className={`font-mono text-xs ${running ? "text-accent" : "text-fg-3"}`}>{running ? "running" : stopped ? `stopped · ${reason ?? "user"}` : "idle"}</span>
      </div>

      {stopped && (reason === "spend-cap" || reason === "time-cap") && (
        <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {reason === "spend-cap" ? "Spend cap reached." : "Time cap reached."} Ants are on the local rule. Raise the cap or Start again.
        </p>
      )}
      {stopped && reason === "formed" && <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">Formed. Jev is paused; the picture costs nothing to hold.</p>}
      {p.state.lastError && <p className="mt-2 truncate rounded-md bg-err-soft px-3 py-2 text-xs text-err" title={p.state.lastError}>{p.state.lastError}</p>}

      <div className="mt-3 flex gap-2">
        {running ? (
          <button type="button" className="flex-1 rounded-md bg-err px-3 py-2 text-sm font-medium text-white hover:opacity-90" onClick={p.stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover" onClick={p.start}>
            Start Jev
          </button>
        )}
        <div className="flex overflow-hidden rounded-md border border-line text-sm">
          <button type="button" className={seg(p.schema === "nouls")} onClick={() => p.setSchema("nouls")} title="3 nouls per ant: north/south, east/west, settle (178 tokens/ant)" disabled={running}>
            nouls
          </button>
          <button type="button" className={seg(p.schema === "compass")} onClick={() => p.setSchema("compass")} title="9-way choice + settle noul (285 tokens/ant)" disabled={running}>
            compass
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Cap label="Spend cap" suffix="$" value={p.caps.capUsd} step={0.1} min={0.01} onChange={(v) => p.setCaps({ ...p.caps, capUsd: v })} disabled={running} />
        <Cap label="Time cap" suffix="s" value={p.caps.capSeconds} step={30} min={10} onChange={(v) => p.setCaps({ ...p.caps, capSeconds: v })} disabled={running} />
      </div>
      <label className="mt-2 flex items-center justify-between text-sm text-fg-2">
        <span>Stop when formed</span>
        <input type="checkbox" checked={p.stopOnFormed} onChange={(e) => p.setStopOnFormed(e.target.checked)} />
      </label>
      <label className="mt-1 flex items-center justify-between text-sm text-fg-2" title="Every 4 s Jev looks at the field and the target as images: a box for the emptiest region (the ants' attractor) and a noul for 'recognisable'">
        <span>Image overseer</span>
        <input type="checkbox" checked={p.overseer} onChange={(e) => p.setOverseer(e.target.checked)} />
      </label>
      {p.state.overseer && (
        <p className="mt-1 font-mono text-xs text-fg-3">
          overseer: recognisable {Math.round(p.state.overseer.done * 100)}% · box {p.state.overseer.box ? (p.state.overseer.steering ? "steering" : "ignored") : "none"} · {p.state.overseer.inputTokens.toLocaleString()} tok/look · {p.state.overseer.calls} looks
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-fg-2">
        <dt className="text-fg-3">cost this run</dt>
        <dd className="text-right text-fg">{run ? usd(run.usd) : "—"}</dd>
        <dt className="text-fg-3">tokens</dt>
        <dd className="text-right">{run ? run.inputTokens.toLocaleString() : "—"}</dd>
        <dt className="text-fg-3">elapsed</dt>
        <dd className="text-right">{run ? `${run.elapsedSeconds.toFixed(0)}s / ${run.caps.capSeconds}s` : "—"}</dd>
        <dt className="text-fg-3">requests</dt>
        <dd className="text-right">{run ? `${run.requests} · ${run.inFlight} open` : "—"}</dd>
        <dt className="text-fg-3">latency</dt>
        <dd className="text-right">{run?.medianMs != null ? `${run.medianMs} / ${run.p90Ms} ms` : "—"}</dd>
        <dt className="text-fg-3">429 / errors</dt>
        <dd className="text-right">{run ? `${run.statuses["429"] ?? 0} / ${p.state.failures}` : "—"}</dd>
        <dt className="text-fg-3">active ants</dt>
        <dd className="text-right">{p.activeAnts}</dd>
        <dt className="text-fg-3">jev decisions</dt>
        <dd className="text-right">{p.jevDecisions.toLocaleString()}</dd>
        <dt className="text-fg-3">session</dt>
        <dd className="text-right">{usd(p.state.sessionUsd)}</dd>
      </dl>

      {p.state.sample && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-fg-3">one ant, live: {p.state.sample.id}</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] leading-snug text-fg-2">
            {JSON.stringify({ state: p.state.sample.state, answers: p.state.sample.answers, decision: p.state.sample.decision }, null, 1)}
          </pre>
        </details>
      )}
    </section>
  );
}

function seg(active: boolean): string {
  return `px-3 py-1.5 ${active ? "bg-accent text-accent-ink" : "bg-panel text-fg-2 hover:bg-raised"} disabled:cursor-not-allowed disabled:opacity-60`;
}

function Cap({ label, suffix, value, step, min, onChange, disabled }: { label: string; suffix: string; value: number; step: number; min: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="block text-sm text-fg-2">
      <span className="text-xs text-fg-3">{label}</span>
      <span className="mt-1 flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 font-mono">
        <span className="text-fg-3">{suffix}</span>
        <input className="w-full bg-transparent text-fg outline-none" type="number" min={min} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      </span>
    </label>
  );
}
