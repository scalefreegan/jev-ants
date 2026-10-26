# jev-ants — product requirements

*Written 2026-10-25 from an interview with Aaron. Every decision below was chosen explicitly; the "why" is kept so later work can revisit it on purpose rather than by accident.*

## 1. Vision

A web app where a few hundred to a couple of thousand ants, scattered at random, walk around and collectively form whatever the user typed or uploaded: a word, a letter, a black-and-white image. The point of the app is to **showcase Jev** (TypeSafe's System One decision model): every ant's step is a Jev decision made from what the ant can see around it. Nothing central plans the picture. It emerges.

Tone is the spirit of the ant colony: self-coordination, local information, a picture nobody drew.

## 2. Decisions from the interview

| Topic | Decision | Why |
|---|---|---|
| Format | Web app. Vite + React + TypeScript + Tailwind v4, Canvas 2D for the field, a small Node proxy for the API key. | Moving a few thousand dots is trivial in a browser; the bottleneck is Jev round trips, not rendering. No heavier engine needed. WebGL points only if we ever want 20k+ ants. |
| Agent model | **Packed requests.** ~100 ants share one `state`; each ant gets its own questions. | Jev evaluates every question in isolation against the shared state, so each ant still gets an independent decision and can genuinely see its neighbours. One state per request is the API's shape; there is no batch endpoint. Measured: 100 ants in ~0.5 s. |
| Ant brain | Three questions per ant: **direction** (choice: 8 compass points + stay), **pace** (score: creep / walk / hurry), **settle** (noul: "this cell still needs ants, stay"). | Extra questions cost almost no latency. Settling is what makes the picture sharpen instead of jitter. |
| Scale | 500 to 2,000 ants, default 1,000. | Enough density for letters and simple images at a 64×64 grid. |
| Cadence | Each **unsettled** ant re-decides about every 2 s and coasts in between; settled ants ask again only when their cell's deficit changes. Scheduler takes the stalest ants every ~200 ms. | 1,000 ants → ≤5 requests of 100 per second at the start, decaying as ants settle. Measured headroom: 8 parallel requests of 100 ants in 0.65 s wall. Parallelism buys latency, not cost (see §8). |
| Spend control | Explicit **Start / Stop**. Running cost from the real `usage.input_tokens` of every response × $0.042/M, never estimated. Three stop conditions, whichever first: **formed** (local grid error under threshold, confirmed by the overseer noul), **time cap** (default 3 min), **spend cap** (default $0.50). Caps editable. After a stop, ants idle on the local rule and Jev is not called. | A demo must never run away, and a formed picture should cost nothing to look at. Cost plan in §8. |
| Images (Jev) | **Overseer.** Every few seconds, send the current field and the target as two images; ask a `box` ("the region of current that most lacks ants vs target") and a `noul` ("current is a recognisable copy of target"). The box becomes an attractor hint in each ant's state; the noul drives a "formed" badge. | Showcases Jev's new image input without making the core loop depend on a feature TypeSafe calls "dreamer-ready, not production-ready". |
| Shading | Target image → greyscale → downsample to a grid (64×64 default) → darkness per cell → normalised so Σ target = ant count. Density is tone. | Text and images are the same pipeline: text is rendered to an offscreen canvas first. |
| Baseline | A **local-rule** mode (greedy toward max neighbouring deficit, with noise) next to Jev mode. | A greedy rule would also form the picture; the demo should show the difference, not assert it. Also the fallback at the spend cap and under 429s. |
| Look | **Ink on warm paper**: lingo-dojo palette. Light: ink ants on `#f6f4ef`; dark: pale ants on charcoal. One jade accent for the overseer box and selected things. Ants are 2 px oriented ticks. | More ants = darker reads naturally as a pen drawing. Reuses an existing, tested token scheme. |
| Controls (v1) | Text input + image upload with live target-grid preview; ant count, sim speed, Jev/local toggle; Jev telemetry panel; overlays (deficit heatmap, overseer box, pheromone trails). | All chosen. |
| End state | Overseer "formed" badge; **Scatter** button; **Morph** (type a new target while formed and ants walk to it). GIF recording deferred to a later milestone. | Scatter is the replay moment. Morph is cheap once the target is just a grid. |
| Deployment | Local first (port **38500**, key from `JEV_API_KEY` in the shell), server written so it can be hosted later with per-visitor budgets. | Same shape as lingo-dojo / travel-guide. |
| Process | Beads (prefix `ja`) + one PR per milestone with agent review before merge. | House convention. |
| Repo | Public, `scalefreegan/jev-ants`, MIT. | Showcase piece. |

## 3. Architecture

```
browser (Vite + React)                          node (Vite dev-server middleware, web/server/)
┌──────────────────────────────────┐            ┌─────────────────────────────────┐
│ sim/        pure TS, no DOM      │            │ api.ts    wrap(): same-origin   │
│   grid.ts   target density grid  │  POST      │ jev.ts    pool of N parallel    │
│   ants.ts   positions, headings  │  /api/jev  │           connections → TypeSafe│
│   local.ts  greedy baseline      │ ─────────► │ budget.ts token/cost ledger     │
│   pack.ts   ants → Jev request   │ ◄───────── │ overseer.ts images → box/noul   │
│   apply.ts  answers → ant intent │  answers   └─────────────────────────────────┘
│ ui/         React, Tailwind v4   │                        │ Bearer JEV_API_KEY
│   Field.tsx canvas renderer      │                        ▼
│   Panel.tsx controls/telemetry   │              https://api.typesafe.ai/v1/systemone
└──────────────────────────────────┘
```

- **Sim loop** runs in the browser with `requestAnimationFrame`. Each tick: move ants by heading × pace, update the density grid, decay pheromone, redraw. Jev answers arrive asynchronously and update each ant's *intent* (heading, pace, settled); the tick loop never waits on the network.
- **Scheduler**: every 200 ms, pick the ants whose last decision is oldest (and not settled, or settled but with a deficit that changed), pack them 100 per request, post. In-flight limit configurable (default 8). Backoff on 429/529 honouring `retry-after`.
- **Server** holds the key, forwards packed requests, counts `usage.input_tokens`, enforces the session cap, and runs the overseer (renders nothing itself; the browser sends two PNGs).
- **Connection pool**: Node's `fetch` on one dispatcher serialised our requests (10 × 50 ants took 2.9 s stacked; separate connections took 0.65 s for 8 × 100). The server must use an undici `Agent` sized for the in-flight limit, and a test must pin that parallel requests overlap.
- `sim/` is pure and covered by `node --test`; the renderer and React layer are thin.

## 4. The Jev contract

### 4.1 Ant request (packed)

```jsonc
{
  "model": "jev-latest",
  "state": {
    "rules": "Each ant is one key in `ants`. deficit3x3 is how many more ants each of the 9 cells around the ant still needs (negative = too many), row-major NW..SE, centre = the ant's own cell. crowd is 0..1 local density. attractor points toward the region the overseer says most lacks ants.",
    "ants": {
      "a17": { "pos": [12, 40], "heading": "NE", "deficit3x3": [0.5, 1.2, -0.3, 0, 2.1, 0.4, -1, 0, 0.2],
               "crowd": 0.8, "nearbyHeadings": ["N", "NE"], "ticksSinceMove": 3, "attractor": "E" },
      "...": {}
    }
  },
  "questions": {
    "a17_dir":    { "type": "choice", "instructions": "Which way should ant `a17` step so the cells that still need ants get filled, avoiding crowding?",
                    "criteria": { "N": "step north", "NE": "…", "E": "…", "SE": "…", "S": "…", "SW": "…", "W": "…", "NW": "…", "stay": "do not move this cycle" } },
    "a17_pace":   { "type": "score", "instructions": "How fast should ant `a17` move this cycle?",
                    "criteria": ["creep: barely move, nearly settled", "walk: normal pace", "hurry: far from where ants are needed"] },
    "a17_settle": { "type": "noul", "instructions": "Ant `a17` is standing in a cell that still needs ants and should settle here." }
  }
}
```

Answers: `choice` carries `confidence` and a full `probabilities` map (we can sample from it for liveliness instead of always taking the argmax); `score` is an expected value 0..2 with `probabilities`; `noul` is a bare probability.

Limits that bind: 64k context tokens per request → about 150 ants per request at ~376 tokens each. We pack 100. The state shape is the main cost lever; a terser schema measured 274 tokens/ant.

### 4.2 Overseer request (images)

Header `TypeSafe-Danger-Zone-Images: true`. Two PNGs (280–1568 px per side) in `assets`, referenced from `state`:

```jsonc
{ "model": "jev-latest",
  "state": { "target": "img-target", "current": "img-current" },
  "assets": { "img-target": { "type": "image", "format": "png", "data_base64": "…" },
              "img-current": { "type": "image", "format": "png", "data_base64": "…" } },
  "questions": {
    "gap":  { "type": "box",  "instructions": "the region of `current` that most lacks ants compared with `target`" },
    "done": { "type": "noul", "instructions": "`current` is a recognisable copy of `target`" } } }
```

`box` returns normalised `{top,bottom,left,right}` in 0..1 and has no "not found"; `done` gates whether we trust it. Runs every ~3 s while not formed, every ~10 s once formed. Image tokens bill at the normal input rate.

## 5. Probe results (2026-10-25, real API, `scripts/probe.mjs`)

| ants / request | status | latency | input tokens | tokens / ant |
|---|---|---|---|---|
| 5 | 200 | 156 ms | 2,181 | 436 |
| 20 | 200 | 494 ms | 7,754 | 388 |
| 50 | 200 | 401 ms | 18,922 | 378 |
| 100 | 200 | 512 ms | 37,576 | 376 |

- Terser state (short keys, fixed small arrays), 100 ants: 27,404 tokens, 459–603 ms → 274 tokens/ant.
- Burst, 8 separate connections × 100 ants: all 200, wall 654 ms. No `retry-after`, no rate-limit headers, no 429 seen.
- Same burst on one Node `fetch` dispatcher: latencies stacked 343 → 2,949 ms. Client-side serialisation; see §3.
- Output tokens are free. Price is $0.042 per million input tokens.
- `GET /v1/models` lists `jev-latest` and `jev-preview` only.

**Cost model.** tokens/s = ants × tokens-per-ant ÷ cadence. At 1,000 ants, 376 tok/ant, 2 s: 188k tok/s → $0.0079/s → **~$28/hour** at full tilt; ~$20/hour with the terser schema; roughly halves at 500 ants or a 4 s cadence. Settled ants are scheduled rarely, so a formed picture costs little to hold. The $1 default cap is about 2–3 minutes of forming at 1,000 ants. The telemetry panel shows all of this live.

## 6. Milestones

Each is a bead (`ja-*`) and lands as one PR.

1. **Scaffold + proxy + probe** — Vite/React/TS/Tailwind, `web/server` with `wrap()`, `/api/jev` forwarding with a parallel connection pool and a test that proves overlap, budget ledger, this PRD, probe script committed.
2. **Sim core + local rule + text targets** — grid, ants, text → density grid, canvas renderer with the paper palette, greedy local mode, ant-count and speed controls. The picture forms without Jev.
3. **Jev ant brain** — pack/apply, scheduler by staleness, in-flight limit, backoff, Jev/local toggle, telemetry panel (in flight, median latency, tokens, cost, 429s, one ant's live state + answers), spend cap and banner.
4. **Overseer** — field + target PNGs, box + noul, attractor into ant state, formed badge, box overlay.
5. **Images, morph, scatter, overlays** — PNG/JPG upload with subject-aware fit, morph to a new target, scatter, deficit heatmap and pheromone trail layers.
6. **Polish + README** — README with a GIF, `macos/` Dock app if wanted, hosting notes with per-visitor budgets.

## 7. Risks and open questions

- **Cost at scale** is the real constraint, not latency. The state schema and cadence are the levers; tune with the telemetry panel.
- **Does Jev steer better than greedy?** Unknown until milestone 3. The toggle exists precisely so we can see. Sampling from `probabilities` instead of argmax may matter for liveliness.
- **Image accuracy**: TypeSafe says all models do worse on images than text. The overseer is a hint, never an authority; the noul gates the box.
- **Rate limits** are per org and unpublished. None hit in the probe; check the console before pushing past ~10 req/s.
- **Browser-direct calls**: CORS unconfirmed and would expose the key. Always via the proxy.

## 8. Cost strategy (added 2026-10-25 after the follow-up)

Jev bills per input token. Parallelism changes latency, not cost: tokens per ant were flat across pack sizes (184 at 100 ants, 187 at 50). So the plan attacks the two factors that do matter, **tokens per decision** and **number of decisions**, and reports only real cost.

### 8.1 Where the tokens go (measured, 100 ants, `scratchpad/decomp.mjs`, `noul.mjs`)

| part | tokens | note |
|---|---|---|
| ant state, compact string | ~45 / ant | `d=1,2,0,-1,3,0,1,2,0 c=0.4 h=NE n=N,SW i=3` plus a legend once |
| one `choice` question, 9 options | ~145 | option descriptions barely matter (full 150, minimal 145) |
| one `choice` question, 5 options | ~85 | roughly 15 tokens per option |
| one `noul` question | ~16 | no criteria |
| original schema (object state, 3 questions) | 376 / ant | §5 |
| terse state, dir choice + pace score + settle noul | 269 / ant | |
| terse state, dir choice only | 191 / ant | |
| **terse state, 3 nouls: north-vs-south, east-vs-west, settle** | **109 / ant** | 3.4× cheaper than the original; heading = atan2(P(north)−0.5, P(east)−0.5) is continuous |

Questions, not state, dominate. A choice over 9 compass points is the single most expensive thing an ant can ask.

### 8.1b Bake-off result (2026-10-25, `scripts/bakeoff.mjs`, 2×100 synthetic ants per schema, live API)

Synthetic states with one unambiguous wanting neighbour (or a cell with room). Chance is 12.5% exact, 37.5% within 45°.

| schema | tokens/ant | latency | direction exact | within 45° | settle when room | leave when over-full |
|---|---|---|---|---|---|---|
| A object + choice9 + score + noul (original) | 324 | 448 ms | 73% | 88% | 63% | 99% |
| B string + choice9 | 211 | 218 ms | 57% | 65% | 75% | 100% |
| C string + 3 nouls | 136 | 198 ms | 25% | 62% | 58% | 91% |
| **D object + 3 nouls (N/S, E/W, settle)** | **178** | 277 ms | 32% | **85%** | **89%** | **100%** |
| D2 terse-key object + 3 nouls | 146 | 210 ms | 27% | 74% | 98% | 87% |
| D3 object + choice9 + settle noul | 285 | 304 ms | 71% | 87% | 88% | 99% |
| E string + choice5 + settle noul | 177 | 219 ms | 42% | 78% | 52% | 91% |

Two lessons. **Structure beats terseness**: the same facts as a compact string (B, C) lose 20 points of steering accuracy against a plain JSON object (A, D); the token saving is not worth it. **Nouls steer as well as a 9-way choice within 45°** (85% vs 88%) at 55% of the tokens, and settle better (89% vs 63%), because the settle question is asked on its own instead of being the "stay" option of a crowded choice. Exact-direction accuracy is lower for nouls by construction: two binary axes land on diagonals, and the heading is read as a continuous angle anyway.

**Default brain: D3** (`compass`). **Selectable: D** (`nouls`) for the demo's comparison. (Revised the same evening — see below.)

**Revision after the first live run (2026-10-25 evening).** With the noul brain, 1,000 ants drifted into the south-west corner. Cause: Jev's "no opinion" on a noul is not 0.5. Flat ants (nothing around them) answered north 0.06 and east 0.19, so a heading read against 0.5 points south-west for every undecided ant; and because the neutral sits near zero, "south" has almost no dynamic range below it. Three calibration ants per request (flat state, answers used as that request's neutral point) fixed the far-hint cases but left the deficit cases noisy; a four-noul variant (N, S, E, W each against its own neutral) was no better (236 tok/ant). The compass choice has its calibration built in (probabilities over nine options sum to one) and, once the state carried an explicit `room` field for the ant's own cell, steered every synthetic group correctly (8/8 on N, S, E, W, SE, far hints, attractor, settle on room ≥ 0) at 296 tok/ant with mean confidence 0.78. The bake-off's synthetic states had an unambiguous wanting neighbour; the live sim is mostly ants with nothing in view, which is where the noul neutral bias bites. Lesson for the PRD: **a noul read as a signed axis needs calibration, and even calibrated it is a poor compass; a choice is self-normalising.** The noul brain stays selectable, with calibration, as the cheaper and visibly worse comparison.

### 8.2 Levers, in order

1. **Ask cheaper questions, but not wrong ones.** The default is the 9-way compass choice plus a settle noul on a structured state with an explicit `room` field (~296 tok/ant). It is 1.6× the cost of the noul brain per decision, but it steers; a brain that sends ants the wrong way costs far more in decisions. No pace question (pace follows confidence).
2. **Make fewer decisions.** Only unsettled ants are scheduled. Each decision buys a **commit distance**: an ant walks 1 cell when near a deficit and up to 3 when far, so the far-away phase costs a third as much. Settled ants re-ask only when their cell's deficit changes sign.
3. **Stop.** Formed, time cap, or spend cap, whichever first. The local grid error (RMS of the deficit grid) is free and is the primary "formed" signal; the overseer noul confirms it for the badge. After a stop the scheduler is off, ants idle on the local rule, and the cost line does not move.
4. **Start/Stop is explicit.** Nothing calls Jev before Start. Scatter and Morph re-arm the scheduler and the caps.

### 8.3 What a run should cost

Estimate at 1,000 ants, compass brain (~296 tok/ant), 2 s cadence, a ~90 s forming run where the active fraction decays from 1 to ~0.2 (mean ~0.5): about 22k decisions × 296 tokens ≈ 6.5M tokens ≈ **$0.27 per formation**; with commit distance roughly **$0.12**. Full-tilt rate is ~150k tokens/s ≈ $22/hour, but a run stops at formed, so the hourly figure only matters if the picture never forms. The $0.50 default cap is therefore several formations, not a fraction of one.

### 8.4 Real cost, not estimates

The server keeps a ledger of `usage.input_tokens` per response and the panel shows: tokens this run, dollars this run (tokens × $0.042/M), elapsed, requests, median latency, and the active-ant count. The per-formation figure from the ledger goes into the README once measured. If TypeSafe exposes a billing endpoint later, the console total should reconcile with the ledger.
