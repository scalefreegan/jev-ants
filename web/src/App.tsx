import Field from "./ui/Field.tsx";
import JevPanel from "./ui/JevPanel.tsx";
import Panel from "./ui/Panel.tsx";
import { useEngine } from "./ui/useEngine.ts";
import { useJev } from "./ui/useJev.ts";

export default function App() {
  const { engine, controls, update, stats, fps, scatter, onFrame } = useEngine();
  const jev = useJev(engine, stats?.formed ?? false);
  return (
    <main className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-4 py-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Jev Ants</h1>
        <p className="text-sm text-fg-3">ants that form the picture you type, one decision at a time</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="min-h-[360px] flex-1" style={{ aspectRatio: `${engine.params.size.w} / ${engine.params.size.h}` }}>
          <Field engine={engine} onFrame={onFrame} showHeatmap={controls.showHeatmap} box={jev.state.overseer?.box ?? null} boxSteering={jev.state.overseer?.steering ?? false} />
        </div>
        <Panel controls={controls} update={update} stats={stats} fps={fps} onScatter={scatter}>
          <JevPanel {...jev} activeAnts={stats ? controls.antCount - stats.settled : controls.antCount} jevDecisions={stats?.decisions.jev ?? 0} />
        </Panel>
      </div>
    </main>
  );
}
