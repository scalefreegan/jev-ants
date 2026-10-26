import type { SchedulerState } from "./jevScheduler.ts";

// The cost line, under the field: one pane with Start/Stop, the running cost
// of this run against its caps, and the request telemetry, so spend is in
// view while the ants move. Settings (schema, caps, toggles) stay in JevPanel.

interface Props {
  state: SchedulerState;
  start: () => void;
  stop: () => void;
  morphPending: boolean;
  activeAnts: number;
  jevDecisions: number;
}

const usd = (v: number) => `$${v.toFixed(4)}`;

export default function JevBar(p: Props) {
  const run = p.state.run;
  const running = p.state.phase === "running";
  const stopped = p.state.phase === "stopped";
  const reason = run?.stopReason;
  const spendShare = run ? Math.min(1, run.usd / run.caps.capUsd) : 0;
  const timeShare = run
    ? Math.min(1, run.elapsedSeconds / run.caps.capSeconds)
    : 0;
  const banner =
    stopped && (reason === "spend-cap" || reason === "time-cap")
      ? {
          tone: "warn",
          text: `${reason === "spend-cap" ? "Spend cap" : "Time cap"} reached. Ants are on the local rule. Raise the cap or Start again.`,
        }
      : p.morphPending
        ? {
            tone: "accent",
            text: "New picture. Morph walks the ants from where they stand into it.",
          }
        : stopped && reason === "formed"
          ? {
              tone: "accent",
              text: "Formed. Jev is paused; the picture costs nothing to hold.",
            }
          : p.state.lastError
            ? { tone: "err", text: p.state.lastError }
            : null;

  return (
    <section
      className="rounded-lg border border-line bg-panel px-4 py-3"
      aria-label="Jev cost and telemetry"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {running ? (
          <button
            type="button"
            className="rounded-md bg-err px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={p.stop}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover"
            onClick={p.start}
          >
            {p.morphPending ? "Morph" : "Start Jev"}
          </button>
        )}

        <div className="min-w-[9rem]">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
              {run ? usd(run.usd) : "$0.0000"}
            </span>
            <span className="text-xs text-fg-3">
              {run ? `of $${run.caps.capUsd.toFixed(2)}` : "this run"}
            </span>
          </div>
          <Meter value={spendShare} />
        </div>

        <Stat
          label="tokens"
          value={run ? run.inputTokens.toLocaleString() : "—"}
        />
        <div className="min-w-[7rem]">
          <Stat
            label="elapsed"
            value={
              run
                ? `${run.elapsedSeconds.toFixed(0)}s / ${run.caps.capSeconds}s`
                : "—"
            }
          />
          <Meter value={timeShare} />
        </div>
        <Stat
          label="requests · open"
          value={run ? `${run.requests} · ${run.inFlight}` : "—"}
        />
        <Stat
          label="latency p50 / p90"
          value={
            run?.medianMs != null ? `${run.medianMs} / ${run.p90Ms} ms` : "—"
          }
        />
        <Stat
          label="429 / errors"
          value={
            run ? `${run.statuses["429"] ?? 0} / ${p.state.failures}` : "—"
          }
        />
        <Stat label="active ants" value={String(p.activeAnts)} />
        <Stat label="jev decisions" value={p.jevDecisions.toLocaleString()} />
        <Stat label="session" value={usd(p.state.sessionUsd)} />

        <span
          className={`ml-auto font-mono text-xs ${running ? "text-accent" : "text-fg-3"}`}
        >
          {running
            ? "running"
            : stopped
              ? `stopped · ${reason ?? "user"}`
              : "idle"}
        </span>
      </div>
      {banner && (
        <p
          className={`mt-3 truncate rounded-md px-3 py-1.5 text-sm ${banner.tone === "warn" ? "bg-warn-soft text-warn" : banner.tone === "err" ? "bg-err-soft text-err" : "bg-accent-soft text-accent"}`}
          title={banner.text}
        >
          {banner.text}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-fg-3">
        {label}
      </span>
      <span className="font-mono text-sm tabular-nums text-fg">{value}</span>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded bg-raised">
      <div
        className={`h-full ${value > 0.85 ? "bg-warn" : "bg-accent"} transition-[width] duration-300`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}
