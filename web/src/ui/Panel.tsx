import { useEffect, useRef, type ReactNode } from "react";
import type { Engine, EngineStats } from "../sim/engine.ts";
import type { Controls } from "./useEngine.ts";

interface Props {
  engine: Engine;
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
  stats: EngineStats | null;
  fps: number;
  onScatter: () => void;
  onImage: (file: File) => void;
  imageError: string | null;
  children?: ReactNode;
}

export default function Panel({ engine, controls, update, stats, fps, onScatter, onImage, imageError, children }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <aside className="flex w-full flex-col gap-5 lg:w-80">
      <section className="rounded-lg border border-line bg-panel p-4">
        <label className="block text-xs font-medium uppercase tracking-wide text-fg-3" htmlFor="text">
          Picture
        </label>
        <textarea
          id="text"
          className="mt-2 w-full resize-none rounded-md border border-line bg-paper px-3 py-2 font-mono text-lg text-fg outline-none focus:border-accent"
          rows={2}
          value={controls.text}
          onChange={(e) => update({ text: e.target.value.toUpperCase() })}
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-fg-3">Type a word; a new line makes a second row.</p>
        <div className="mt-3 flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
          <button type="button" className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-fg hover:bg-raised" onClick={() => fileRef.current?.click()} title="A black-and-white picture works best; drop one on the field too">
            Upload image…
          </button>
          {controls.image && (
            <button type="button" className="flex min-w-0 items-center gap-1 text-sm text-fg-2 hover:text-fg" onClick={() => update({ image: null })} title="Back to the text">
              <span className="truncate font-mono text-xs">{controls.image.name}</span>
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
        {imageError && <p className="mt-1 text-xs text-err">{imageError}</p>}
        <TargetPreview engine={engine} version={stats?.targetVersion ?? 0} />
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <Slider label="Ants" value={controls.antCount} min={200} max={2000} step={50} format={(v) => String(v)} onChange={(v) => update({ antCount: v })} />
        <Slider label="Speed" value={controls.speed} min={0.25} max={3} step={0.25} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speed: v })} />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-fg-2">Brain</span>
          <div className="flex overflow-hidden rounded-md border border-line text-sm">
            <button type="button" className={seg(controls.brain === "jev")} onClick={() => update({ brain: "jev" })} title="Ants drift until you Start Jev; every step is then a Jev decision">
              Jev
            </button>
            <button type="button" className={seg(controls.brain === "local")} onClick={() => update({ brain: "local" })} title="The greedy local rule, free, for comparison">
              Local rule
            </button>
          </div>
        </div>
        <label className="mt-3 flex items-center justify-between text-sm text-fg-2">
          <span>Deficit heatmap</span>
          <input type="checkbox" checked={controls.showHeatmap} onChange={(e) => update({ showHeatmap: e.target.checked })} />
        </label>
        <label className="mt-1 flex items-center justify-between text-sm text-fg-2">
          <span>Pheromone trails</span>
          <input type="checkbox" checked={controls.showTrails} onChange={(e) => update({ showTrails: e.target.checked })} />
        </label>
        <div className="mt-4 flex gap-2">
          <button type="button" className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover" onClick={() => update({ playing: !controls.playing })}>
            {controls.playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-fg hover:bg-raised" onClick={onScatter}>
            Scatter
          </button>
        </div>
      </section>

      {children}

      <section className="rounded-lg border border-line bg-panel p-4 font-mono text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-fg-3">formed</span>
          <span className={stats?.formed ? "text-accent" : "text-fg"}>{stats ? `${Math.round(stats.coverage * 100)}%` : "—"}</span>
        </div>
        <Bar value={stats?.coverage ?? 0} />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-fg-2">
          <dt className="text-fg-3">settled</dt>
          <dd className="text-right">{stats ? `${stats.settled} / ${controls.antCount}` : "—"}</dd>
          <dt className="text-fg-3">decisions</dt>
          <dd className="text-right">{stats ? `${stats.decisions.local.toLocaleString()} local` : "—"}</dd>
          <dt className="text-fg-3">sim time</dt>
          <dd className="text-right">{stats ? `${stats.time.toFixed(1)}s` : "—"}</dd>
          <dt className="text-fg-3">fps</dt>
          <dd className="text-right">{fps}</dd>
        </dl>
      </section>
    </aside>
  );
}

/** The target grid as it is: what the ants are asked to draw, darkest cell = full ink. */
function TargetPreview({ engine, version }: { engine: Engine; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { w, h } = engine.params.size;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const t = engine.target;
    let max = 0;
    for (let i = 0; i < t.length; i++) max = Math.max(max, t[i] as number);
    for (let i = 0; i < t.length; i++) {
      const v = max > 0 ? (t[i] as number) / max : 0;
      const o = i * 4;
      img.data[o] = 30;
      img.data[o + 1] = 28;
      img.data[o + 2] = 24;
      img.data[o + 3] = Math.round(255 * v);
    }
    ctx.putImageData(img, 0, 0);
  }, [engine, version]);
  return <canvas ref={ref} className="mt-3 w-full rounded border border-line bg-paper [image-rendering:pixelated]" style={{ aspectRatio: `${engine.params.size.w} / ${engine.params.size.h}` }} aria-label="target preview" />;
}

function seg(active: boolean): string {
  return `px-3 py-1.5 ${active ? "bg-accent text-accent-ink" : "bg-panel text-fg-2 hover:bg-raised"}`;
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="flex justify-between text-sm text-fg-2">
        <span>{label}</span>
        <span className="font-mono text-fg">{format(value)}</span>
      </span>
      <input className="mt-1 w-full" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-raised">
      <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
