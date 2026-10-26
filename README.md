# Jev Ants

Ants that form the picture you type, one decision at a time. Every ant is its own
[Jev](https://typesafe.ai) agent: it sees the nine cells around it, how many ants each
still wants, and the headings of its neighbours, and Jev answers *which way* and
*whether to settle*. From a random scatter, a thousand of those small decisions turn
into a word, or an uploaded picture, in about fifteen seconds and seven cents.

![ANTS forming](docs/ants.gif)

## Run it

```sh
export JEV_API_KEY=...      # your TypeSafe key; the browser never sees it
cd web && npm install && npm run dev
open http://localhost:38500
```

The dev server is the app: Vite serves the React front end and a small middleware
holds the key, forwards packed requests to `api.typesafe.ai`, and enforces the
spend and time caps from the real `usage.input_tokens` of every reply.

## What you can do

- **Type a word** (two lines make two rows) or **upload an image** (button, or drop
  it on the field). Black-and-white pictures work best; the target preview shows
  what the ants are asked to draw.
- **Start Jev.** Ants scatter and Jev steers them. The panel shows the running
  cost, tokens, latency, requests in flight, and one ant's live state and answer.
- **Stop** any time, or let it stop by itself: when the picture is formed, at the
  **spend cap** (default $0.50) or at the **time cap** (default 3 min). A formed
  picture costs nothing to hold.
- **Morph.** Change the picture while stopped and press Morph: the ants walk from the
  old shape into the new one. **Scatter** replays a formation from scratch.
- **Image overseer.** Every 4 s Jev looks at the field and the target as two PNGs and
  returns a box (the region most lacking ants, drawn in jade and used as an
  attractor when it points at ink) and a "recognisable" noul.
- **Overlays**: deficit heatmap, pheromone trails. **Local rule** brain for a free
  comparison with a greedy gradient walk.

## How it talks to Jev

One request carries about a hundred ants. The state is a JSON object with one key
per ant; each ant gets its own `choice` (eight compass directions or stay) and its
own `noul` (settle). Jev evaluates each question against the state independently,
so a packed request costs the same as a hundred single ones but takes one round
trip (~300 ms). Six requests run in parallel, which is the browser's connection
limit per host. Details, the schema bake-off and the measured token budget are in
[docs/PRD.md](docs/PRD.md).

| | per ant | per 1,000-ant formation |
|---|---|---|
| State | ~45 tokens | |
| Compass choice + settle noul | ~250 tokens | |
| Decisions needed | ~5 | ~1.7 M tokens |
| Cost at $0.042 / M input tokens | | **≈ $0.07** |

Output tokens are free. The overseer adds about 1,300 tokens per look.

## Hosting

The app is a Vite dev server with middleware, run locally. To host it: build the
front end (`npm run build`), serve `web/dist` statically, and run the same handlers
from `web/server/api.ts` behind any Node HTTP server with `JEV_API_KEY` in its
environment. The handlers check `Origin` against the host and keep the key out of
every response and log. Each visitor shares one spend ledger, so a hosted copy
should lower the default caps.

## Development

```sh
cd web
npm test          # sim + server tests (node --test, native TS)
npm run lint      # oxlint
npx tsc -b        # types
```

`web/src/sim` is pure and testable headless; `web/server` is the proxy and ledger;
`web/src/ui` is React and canvas. Work is tracked with [beads](https://github.com/steveyegge/beads)
(`bd ready`). MIT.
