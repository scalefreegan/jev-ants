import type { JevAnswer, JevRequest } from "../../shared/jev.ts";
import type { GridSize } from "./grid.ts";

// The overseer: Jev's image input in the loop, pure half. Every few seconds the
// browser renders the target and the current field as two small PNGs and asks
// one box question ("where is current emptiest compared with target?") and one
// noul ("is current a recognisable copy of target?"). The box becomes the
// attractor every ant can see in its state; the noul feeds the formed badge.
// TypeSafe calls image input "dreamer-ready": the overseer is a hint, never an
// authority, and the ants form the picture without it.

export const OVERSEER_INSTRUCTIONS = {
  gap: "The region of `current` that most lacks ants compared with `target`: where the dark parts of `target` are still pale in `current`.",
  done: "`current` is a recognisable copy of `target`: the same shapes, letters or picture, drawn in ants.",
};

export function buildOverseerRequest(targetPngBase64: string, currentPngBase64: string): JevRequest {
  return {
    state: {
      legend: "Two pictures. `target` is what the ants are asked to form: darker means more ants wanted. `current` is where the ants stand right now, drawn the same way.",
      target: "img-target",
      current: "img-current",
    },
    assets: {
      "img-target": { type: "image", format: "png", data_base64: targetPngBase64 },
      "img-current": { type: "image", format: "png", data_base64: currentPngBase64 },
    },
    questions: {
      gap: { type: "box", instructions: OVERSEER_INSTRUCTIONS.gap },
      done: { type: "noul", instructions: OVERSEER_INSTRUCTIONS.done },
    },
  };
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface OverseerReading {
  /** normalised 0..1 edges, or null when the answer was missing or degenerate */
  box: Box | null;
  boxConfidence: number | null;
  /** P(current is a recognisable copy of target) */
  done: number;
}

const unit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function readOverseer(answers: Record<string, JevAnswer>): OverseerReading | null {
  const gap = answers.gap;
  const done = answers.done;
  if (!done || done.type !== "noul" || !unit(done.noul)) return null;
  let box: Box | null = null;
  let boxConfidence: number | null = null;
  if (gap && gap.type === "box" && gap.box) {
    const b = gap.box;
    if (unit(b.top) && unit(b.bottom) && unit(b.left) && unit(b.right) && b.bottom > b.top && b.right > b.left) {
      box = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      boxConfidence = typeof gap.confidence === "number" ? gap.confidence : null;
    }
  }
  return { box, boxConfidence, done: done.noul };
}

/** The box's centre in cell coordinates. */
export function boxCentre(box: Box, size: GridSize): { x: number; y: number } {
  return { x: ((box.left + box.right) / 2) * size.w, y: ((box.top + box.bottom) / 2) * size.h };
}

/**
 * Is the box worth steering by? A box covering most of the picture says
 * nothing; so does one over a region the target leaves blank. Returns the
 * share of the target's ink inside the box.
 */
export function boxInkShare(box: Box, target: Float32Array, size: GridSize): number {
  let inside = 0;
  let total = 0;
  for (let y = 0; y < size.h; y++) {
    const fy = (y + 0.5) / size.h;
    for (let x = 0; x < size.w; x++) {
      const v = target[y * size.w + x] as number;
      total += v;
      const fx = (x + 0.5) / size.w;
      if (fx >= box.left && fx <= box.right && fy >= box.top && fy <= box.bottom) inside += v;
    }
  }
  return total > 0 ? inside / total : 0;
}

export function boxArea(box: Box): number {
  return (box.right - box.left) * (box.bottom - box.top);
}
