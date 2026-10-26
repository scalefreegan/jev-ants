import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine, type Brain, type EngineStats } from "../sim/engine.ts";
import { normalizeTarget } from "../sim/grid.ts";
import { imageToDarkness, textToDarkness } from "../sim/targets.ts";

// Owns the one Engine and the animation loop. React state carries only what
// the panel shows (stats, params); the renderer reads the engine directly
// every frame, so 2,000 ants never pass through React.

export interface Controls {
  text: string;
  /** an uploaded picture wins over the text while it is set */
  image: { name: string; darkness: Float32Array } | null;
  antCount: number;
  speed: number;
  brain: Brain;
  playing: boolean;
  showHeatmap: boolean;
  showTrails: boolean;
}

export const DEFAULT_CONTROLS: Controls = { text: "ANTS", antCount: 1000, speed: 1, brain: "jev", playing: true, showHeatmap: false, showTrails: false, image: null };

export function useEngine(initial: Controls = DEFAULT_CONTROLS) {
  // One engine for the component's life; the hook mutates its params in place on purpose.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => new Engine({ antCount: initial.antCount, brain: initial.brain, speed: initial.speed }), []);

  const [controls, setControls] = useState<Controls>(initial);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [fps, setFps] = useState(0);
  const darknessRef = useRef<Float32Array | null>(null);
  const frameListeners = useRef(new Set<() => void>());

  // Target: image or text → darkness (cached) → normalised to the current ant
  // count. A new picture in Jev mode puts idle ants back to wandering, so the
  // free local rule does not quietly form it before Jev is asked to.
  useEffect(() => {
    darknessRef.current = controls.image ? controls.image.darkness : textToDarkness(controls.text, engine.params.size);
    engine.setTarget(normalizeTarget(darknessRef.current, engine.world.n));
    if (engine.params.brain === "jev") engine.idleBehaviour = "wander";
  }, [controls.text, controls.image, engine]);

  useEffect(() => {
    if (controls.antCount !== engine.world.n) {
      engine.setAntCount(controls.antCount);
      if (darknessRef.current) engine.setTarget(normalizeTarget(darknessRef.current, engine.world.n));
    }
  }, [controls.antCount, engine]);

  useEffect(() => {
    engine.params.speed = controls.speed;
    engine.params.brain = controls.brain;
    // Switching to the local rule and back: a fresh jev-mode idle wanders again.
    if (controls.brain === "jev") engine.idleBehaviour = "wander";
  }, [controls.speed, controls.brain, engine]);

  // The loop. dt is clamped so a background tab does not fast-forward on return.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastStats = 0;
    let frames = 0;
    let fpsAt = last;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (controls.playing) {
        const s = engine.tick(dt);
        if (t - lastStats > 100) {
          setStats(s);
          lastStats = t;
        }
      }
      frames++;
      if (t - fpsAt > 1000) {
        setFps(frames);
        frames = 0;
        fpsAt = t;
      }
      for (const fn of frameListeners.current) fn();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controls.playing, engine]);

  const onFrame = useCallback((fn: () => void) => {
    frameListeners.current.add(fn);
    return () => void frameListeners.current.delete(fn);
  }, []);

  const scatter = useCallback(() => engine.scatter(), [engine]);
  const update = useCallback((patch: Partial<Controls>) => setControls((c) => ({ ...c, ...patch })), []);
  const [imageError, setImageError] = useState<string | null>(null);
  const loadImage = useCallback(
    async (file: File) => {
      try {
        const bmp = await createImageBitmap(file);
        const darkness = imageToDarkness(bmp, engine.params.size);
        bmp.close();
        setImageError(null);
        setControls((c) => ({ ...c, image: { name: file.name, darkness } }));
      } catch {
        setImageError(`Could not read ${file.name} as an image.`);
      }
    },
    [engine],
  );

  return useMemo(() => ({ engine, controls, update, stats, fps, scatter, onFrame, loadImage, imageError }), [engine, controls, update, stats, fps, scatter, onFrame, loadImage, imageError]);
}
