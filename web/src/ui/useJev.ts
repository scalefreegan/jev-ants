import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunCaps } from "../../shared/jev.ts";
import { DEFAULT_CAPS } from "../../shared/jev.ts";
import type { Engine } from "../sim/engine.ts";
import type { Schema } from "../sim/jevBrain.ts";
import { JevScheduler, type SchedulerState } from "./jevScheduler.ts";

// React face of the scheduler: one instance per engine, its state mirrored
// into React, caps and schema editable, and the "formed → stop" rule.

export function useJev(engine: Engine, formed: boolean) {
  const scheduler = useMemo(() => new JevScheduler(engine), [engine]);
  const [state, setState] = useState<SchedulerState>(scheduler.state);
  const [caps, setCaps] = useState<RunCaps>(DEFAULT_CAPS);
  const [schema, setSchemaState] = useState<Schema>("compass");
  const [stopOnFormed, setStopOnFormed] = useState(true);

  useEffect(() => {
    const off = scheduler.subscribe(setState);
    return () => {
      off();
      scheduler.dispose();
    };
  }, [scheduler]);

  const start = useCallback(() => void scheduler.start(caps), [scheduler, caps]);
  const stop = useCallback(() => void scheduler.stop("user"), [scheduler]);
  const setSchema = useCallback(
    (s: Schema) => {
      scheduler.setOptions({ schema: s });
      setSchemaState(s);
    },
    [scheduler],
  );

  // Formed while running: stop spending. Only after Jev has actually decided
  // something and a few seconds have passed, so a picture the local rule left
  // behind does not end the run before it starts.
  useEffect(() => {
    if (formed && stopOnFormed && state.phase === "running" && state.requestsSent > 0 && scheduler.runSeconds > 3) void scheduler.stop("formed");
  }, [formed, stopOnFormed, state.phase, state.requestsSent, scheduler]);

  return { state, caps, setCaps, schema, setSchema, start, stop, stopOnFormed, setStopOnFormed };
}
