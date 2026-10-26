// Schema bake-off (bead ja-54g): cost × steering accuracy on the live API.
// Synthetic ant states with a known best direction and a known settle answer,
// packed 100 per request, one request per candidate schema per batch. Prints
// a markdown table: tokens/ant, direction accuracy (exact and within 45°),
// settle accuracy, latency. Spends about a cent per run.
// Usage: JEV_API_KEY=… node scripts/bakeoff.mjs [batches=2] [antsPerRequest=100]
const KEY = process.env.JEV_API_KEY;
if (!KEY) { console.error("JEV_API_KEY not set"); process.exit(1); }
const BATCHES = Number(process.argv[2]) || 2;
const N = Number(process.argv[3]) || 100;
const URL_ = "https://api.typesafe.ai/v1/systemone";

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
// row-major NW..SE index of each compass direction in a 3×3
const IDX = { NW: 0, N: 1, NE: 2, W: 3, E: 5, SW: 6, S: 7, SE: 8 };
const ANGLE = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];

/** One synthetic ant: an unambiguous wanting neighbour, or a cell with room (settle). */
function scenario() {
  const settle = rnd() < 0.3;
  const d = Array.from({ length: 9 }, () => (rnd() < 0.5 ? 0 : -1));
  let dir = null;
  if (settle) {
    d[4] = 1 + Math.floor(rnd() * 2); // own cell wants 1–2 more
    dir = "stay";
  } else {
    d[4] = -2 - Math.floor(rnd() * 2); // own cell is over-full
    dir = pick(DIRS);
    d[IDX[dir]] = 3 + Math.floor(rnd() * 2);
  }
  return { d, crowd: +(0.2 + rnd() * 0.7).toFixed(1), heading: pick(DIRS), nearby: Array.from({ length: Math.floor(rnd() * 3) }, () => pick(DIRS)), idle: Math.floor(rnd() * 9), truthDir: dir, truthSettle: settle };
}

const LEGEND_STR = "Each ant is one key in `ants`, written 'd=<9 ints> c=<0..1> h=<heading> n=<neighbour headings> i=<ticks idle>'. d lists how many more ants each of the 9 cells around the ant still needs, row-major from north-west to south-east (NW N NE / W centre E / SW S SE); the centre is the ant's own cell and negative means too many ants there. c is local crowding, h the ant's heading, n headings of nearby ants.";
const LEGEND_OBJ = "Each ant is one key in `ants`. deficit3x3 lists how many more ants each of the 9 cells around the ant still needs, row-major from north-west to south-east (NW N NE / W centre E / SW S SE); the centre is the ant's own cell and negative means too many ants there. crowd is local density 0..1.";
const strAnt = (s) => `d=${s.d.join(",")} c=${s.crowd} h=${s.heading} n=${s.nearby.join(",") || "-"} i=${s.idle}`;
const objAnt = (s) => ({ deficit3x3: s.d, crowd: s.crowd, heading: s.heading, nearbyHeadings: s.nearby, ticksSinceMove: s.idle });
const CHOICE9 = { N: "step north", NE: "step north-east", E: "step east", SE: "step south-east", S: "step south", SW: "step south-west", W: "step west", NW: "step north-west", stay: "stay: this cell still needs ants" };
const CHOICE5 = { N: "step north", E: "step east", S: "step south", W: "step west", stay: "stay: this cell still needs ants" };

// Each candidate: build(state, questions, id, scenario) and read(answers, id) → { dir, pSettle }
const CANDIDATES = {
  "A object + choice9 + score + noul (original)": {
    legend: LEGEND_OBJ, ant: objAnt,
    q: (id) => ({ [`${id}_dir`]: { type: "choice", instructions: `Which way should ant \`${id}\` step so the cells that still need ants get filled, avoiding crowding?`, criteria: CHOICE9 }, [`${id}_pace`]: { type: "score", instructions: `How fast should ant \`${id}\` move this cycle?`, criteria: ["creep", "walk", "hurry"] }, [`${id}_settle`]: { type: "noul", instructions: `Ant \`${id}\` is standing in a cell that still needs ants and should settle here.` } }),
    read: (a, id) => ({ dir: a[`${id}_dir`]?.choice, pSettle: a[`${id}_settle`]?.noul }),
  },
  "B string + choice9": {
    legend: LEGEND_STR, ant: strAnt,
    q: (id) => ({ [`${id}_d`]: { type: "choice", instructions: `Where should ${id} step to fill a cell that needs ants? stay = its own cell still needs it.`, criteria: CHOICE9 } }),
    read: (a, id) => { const c = a[`${id}_d`]; return { dir: c?.choice, pSettle: c?.probabilities?.stay }; },
  },
  "C string + 3 nouls (N/S, E/W, settle)": {
    legend: LEGEND_STR, ant: strAnt,
    q: (id) => ({ [`${id}_n`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is north of it rather than south (ignore east/west).` }, [`${id}_e`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is east of it rather than west (ignore north/south).` }, [`${id}_s`]: { type: "noul", instructions: `${id}'s own cell (the centre of d) still needs more ants, so ${id} should stay.` } }),
    read: (a, id) => ({ dir: noulDir(a[`${id}_n`]?.noul, a[`${id}_e`]?.noul), pSettle: a[`${id}_s`]?.noul }),
  },
  "D object + 3 nouls": {
    legend: LEGEND_OBJ, ant: objAnt,
    q: (id) => ({ [`${id}_n`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is north of it rather than south (ignore east/west).` }, [`${id}_e`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is east of it rather than west (ignore north/south).` }, [`${id}_s`]: { type: "noul", instructions: `${id}'s own cell (the centre of deficit3x3) still needs more ants, so ${id} should stay.` } }),
    read: (a, id) => ({ dir: noulDir(a[`${id}_n`]?.noul, a[`${id}_e`]?.noul), pSettle: a[`${id}_s`]?.noul }),
  },
  "D2 terse-key object + 3 nouls": {
    legend: "Each ant is one key in `ants`: d = how many more ants each of the 9 cells around it still needs, row-major from north-west to south-east (NW N NE / W centre E / SW S SE), centre = its own cell, negative = too many; c = local crowding 0..1; h = heading.", ant: (s) => ({ d: s.d, c: s.crowd, h: s.heading }),
    q: (id) => ({ [`${id}_n`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is north of it rather than south (ignore east/west).` }, [`${id}_e`]: { type: "noul", instructions: `The cell that most needs ants near ${id} is east of it rather than west (ignore north/south).` }, [`${id}_s`]: { type: "noul", instructions: `${id}'s own cell (the centre of d) still needs more ants, so ${id} should stay.` } }),
    read: (a, id) => ({ dir: noulDir(a[`${id}_n`]?.noul, a[`${id}_e`]?.noul), pSettle: a[`${id}_s`]?.noul }),
  },
  "D3 object + choice9 + settle noul (no pace)": {
    legend: LEGEND_OBJ, ant: objAnt,
    q: (id) => ({ [`${id}_dir`]: { type: "choice", instructions: `Which way should ant \`${id}\` step so the cells that still need ants get filled, avoiding crowding?`, criteria: CHOICE9 }, [`${id}_settle`]: { type: "noul", instructions: `${id}'s own cell (the centre of deficit3x3) still needs more ants, so ${id} should stay.` } }),
    read: (a, id) => ({ dir: a[`${id}_dir`]?.choice, pSettle: a[`${id}_settle`]?.noul }),
  },
  "E string + choice5 + settle noul": {
    legend: LEGEND_STR, ant: strAnt,
    q: (id) => ({ [`${id}_d`]: { type: "choice", instructions: `Where should ${id} step to fill a cell that needs ants?`, criteria: CHOICE5 }, [`${id}_s`]: { type: "noul", instructions: `${id}'s own cell (the centre of d) still needs more ants, so ${id} should stay.` } }),
    read: (a, id) => ({ dir: a[`${id}_d`]?.choice, pSettle: a[`${id}_s`]?.noul }),
  },
};

function noulDir(pNorth, pEast) {
  if (typeof pNorth !== "number" || typeof pEast !== "number") return undefined;
  const vy = -(pNorth - 0.5), vx = pEast - 0.5; // screen coords: north is −y
  if (Math.hypot(vx, vy) < 0.05) return "stay";
  const deg = ((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360;
  return DIRS.reduce((best, d) => (angDiff(deg, ANGLE[d]) < angDiff(deg, ANGLE[best]) ? d : best), "E");
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

async function call(body) {
  const t0 = performance.now();
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const j = await r.json();
  return { status: r.status, ms: Math.round(performance.now() - t0), j };
}

const rows = [];
for (const [name, c] of Object.entries(CANDIDATES)) {
  let tokens = 0, ms = 0, n = 0, exact = 0, near = 0, settleRight = 0, settleN = 0, moveN = 0, moveRightSettle = 0;
  for (let b = 0; b < BATCHES; b++) {
    seed = 1000 + b; // same scenarios for every candidate
    const scen = Array.from({ length: N }, scenario);
    const state = { legend: c.legend, ants: {} }, questions = {};
    scen.forEach((s, i) => { state.ants[`a${i}`] = c.ant(s); Object.assign(questions, c.q(`a${i}`)); });
    const r = await call({ model: "jev-latest", state, questions });
    if (r.status !== 200) { console.error(name, r.status, JSON.stringify(r.j).slice(0, 200)); continue; }
    tokens += r.j.usage.input_tokens; ms += r.ms; n += N;
    scen.forEach((s, i) => {
      const { dir, pSettle } = c.read(r.j.answers, `a${i}`);
      if (s.truthSettle) { settleN++; if (typeof pSettle === "number" && pSettle >= 0.5) settleRight++; }
      else {
        moveN++;
        if (typeof pSettle === "number" && pSettle < 0.5) moveRightSettle++;
        if (dir === s.truthDir) exact++;
        if (dir && dir !== "stay" && angDiff(ANGLE[dir], ANGLE[s.truthDir]) <= 45) near++;
      }
    });
  }
  if (!n) continue;
  rows.push({ name, tokPerAnt: Math.round(tokens / n), ms: Math.round(ms / BATCHES), exact: pct(exact, moveN), near: pct(near, moveN), settleHit: pct(settleRight, settleN), leaveHit: pct(moveRightSettle, moveN) });
  console.error(`done ${name}`);
}
function pct(a, b) { return b ? `${Math.round((100 * a) / b)}%` : "—"; }
console.log(`\nBake-off ${new Date().toISOString().slice(0, 10)} — ${BATCHES}×${N} ants per candidate, model jev-latest. Chance: exact 12.5%, within 45° 37.5%.\n`);
console.log("| schema | tokens/ant | latency | direction exact | within 45° | settle when room | leave when over-full |");
console.log("|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.name} | ${r.tokPerAnt} | ${r.ms} ms | ${r.exact} | ${r.near} | ${r.settleHit} | ${r.leaveHit} |`);
