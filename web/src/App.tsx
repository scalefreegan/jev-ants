import Field from "./ui/Field.tsx";
import JevBar from "./ui/JevBar.tsx";
import JevPanel from "./ui/JevPanel.tsx";
import Panel from "./ui/Panel.tsx";
import { useEngine } from "./ui/useEngine.ts";
import { useJev } from "./ui/useJev.ts";

export default function App() {
  const {
    engine,
    controls,
    update,
    stats,
    fps,
    scatter,
    onFrame,
    loadImage,
    imageError,
  } = useEngine();
  const jev = useJev(engine, stats?.formed ?? false, stats?.targetVersion ?? 0);
  return (
    <main className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-4 py-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Jev Ants</h1>
        <p className="text-sm text-fg-3">
          ants that form the picture you type, one decision at a time
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div
            className="min-h-[360px]"
            style={{
              aspectRatio: `${engine.params.size.w} / ${engine.params.size.h}`,
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void loadImage(f);
            }}
          >
            <Field
              engine={engine}
              onFrame={onFrame}
              showHeatmap={controls.showHeatmap}
              showTrails={controls.showTrails}
              box={jev.state.overseer?.box ?? null}
              boxSteering={jev.state.overseer?.steering ?? false}
            />
          </div>
          <JevBar
            state={jev.state}
            start={jev.start}
            stop={jev.stop}
            morphPending={jev.morphPending}
            activeAnts={
              stats ? controls.antCount - stats.settled : controls.antCount
            }
            jevDecisions={stats?.decisions.jev ?? 0}
          />
        </div>
        <Panel
          engine={engine}
          controls={controls}
          update={update}
          stats={stats}
          fps={fps}
          onScatter={scatter}
          onImage={(f) => void loadImage(f)}
          imageError={imageError}
        >
          <JevPanel
            state={jev.state}
            caps={jev.caps}
            setCaps={jev.setCaps}
            schema={jev.schema}
            setSchema={jev.setSchema}
            stopOnFormed={jev.stopOnFormed}
            setStopOnFormed={jev.setStopOnFormed}
            overseer={jev.overseer}
            setOverseer={jev.setOverseer}
          />
        </Panel>
      </div>
    </main>
  );
}
