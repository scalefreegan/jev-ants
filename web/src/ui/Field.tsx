import { useEffect, useRef } from "react";
import type { Engine } from "../sim/engine.ts";

// The paper. A canvas that fills its box at device resolution and redraws
// every frame straight from the engine's typed arrays: ants as short ticks
// along their heading (ink), settled ants a touch darker and thicker. The
// optional heatmap paints the raw deficit — jade where ants are still
// wanted, warm where there are too many — through a grid-sized ImageData
// scaled up without smoothing, so cells stay crisp.

interface Props {
  engine: Engine;
  onFrame: (fn: () => void) => () => void;
  showHeatmap: boolean;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function Field({ engine, onFrame, showHeatmap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement | null>(null);
  const showHeat = useRef(showHeatmap);
  useEffect(() => {
    showHeat.current = showHeatmap;
  }, [showHeatmap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { w: gw, h: gh } = engine.params.size;
    const heat = (heatRef.current ??= document.createElement("canvas"));
    heat.width = gw;
    heat.height = gh;
    const heatCtx = heat.getContext("2d")!;
    const heatImg = heatCtx.createImageData(gw, gh);

    let paper = cssVar("--paper");
    let ink = cssVar("--ink");
    let inkSettled = cssVar("--ink-settled");
    let heatRgb = cssVar("--heat").split(/\s+/).map(Number);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => {
      paper = cssVar("--paper");
      ink = cssVar("--ink");
      inkSettled = cssVar("--ink-settled");
      heatRgb = cssVar("--heat").split(/\s+/).map(Number);
    };
    mq.addEventListener("change", retheme);

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    fit();

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      const sx = W / gw;
      const sy = H / gh;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);

      if (showHeat.current) {
        const d = engine.deficit;
        let max = 0.5;
        for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i] as number));
        const px = heatImg.data;
        for (let i = 0; i < d.length; i++) {
          const v = d[i] as number;
          const o = i * 4;
          if (v > 0.05) {
            px[o] = heatRgb[0] as number;
            px[o + 1] = heatRgb[1] as number;
            px[o + 2] = heatRgb[2] as number;
            px[o + 3] = Math.min(200, 40 + (160 * v) / max);
          } else if (v < -0.5) {
            px[o] = 196;
            px[o + 1] = 110;
            px[o + 2] = 40;
            px[o + 3] = Math.min(200, 40 + (160 * -v) / max);
          } else px[o + 3] = 0;
        }
        heatCtx.putImageData(heatImg, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(heat, 0, 0, W, H);
      }

      const w = engine.world;
      const len = Math.max(2, Math.min(sx, sy) * 0.55);
      const half = len / 2;
      ctx.lineCap = "round";
      for (const pass of [0, 1] as const) {
        ctx.beginPath();
        for (let i = 0; i < w.n; i++) {
          if ((w.settled[i] as number) !== pass) continue;
          const x = (w.x[i] as number) * sx;
          const y = (w.y[i] as number) * sy;
          const c = Math.cos(w.heading[i] as number) * half;
          const s = Math.sin(w.heading[i] as number) * half;
          ctx.moveTo(x - c, y - s);
          ctx.lineTo(x + c, y + s);
        }
        ctx.strokeStyle = pass ? inkSettled : ink;
        ctx.lineWidth = pass ? Math.max(1.4, len * 0.5) : Math.max(1, len * 0.38);
        ctx.globalAlpha = pass ? 1 : 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const off = onFrame(draw);
    draw();
    return () => {
      off();
      ro.disconnect();
      mq.removeEventListener("change", retheme);
    };
  }, [engine, onFrame]);

  return <canvas ref={canvasRef} className="block h-full w-full rounded-lg border border-line" aria-label="ant field" />;
}
