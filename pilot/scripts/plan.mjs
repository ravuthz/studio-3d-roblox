// Turns word timings into the edit plan: cut times, timed events, total length.
// Writes story/plan.js (for the composition) and story/plan.json (for audio.py).
// Run from the project root:  node pilot/scripts/plan.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(p("../story/timing.js"), "utf8"), ctx);
const T = ctx.window.STORY_TIMING;
const FPS = 30;
const snap = (t) => Math.round(t * FPS) / FPS; // cuts land on frame boundaries
const line = (id) => T.lines.find((l) => l.id === id);
const word = (id, w, nth = 0) => {
  const li = T.lines.findIndex((l) => l.id === id);
  const hits = T.words.filter(
    (x) => x.line === li && x.w.toLowerCase().replace(/[^a-z]/g, "") === w.toLowerCase(),
  );
  if (!hits[nth]) throw new Error(`word not found: ${id}/${w}`);
  return hits[nth].s;
};
const LEAD = 0.1; // picture cuts slightly before the phrase lands
const at = (id) => snap(Math.max(0, line(id).start - LEAD));

const cuts = {
  hookA: 0,
  hookB: snap(word("hook", "born") - 0.05),
  zero: at("zero"),
  zeebra: at("zeebra"),
  luna: at("luna"),
  zipA: at("zip"),
  zipB: snap(word("zip", "a") - 0.08),
  rule: at("rule"),
  meA: at("me"),
  meB: snap(word("me", "since") - 0.08),
  night: at("night"),
  count1: snap(word("count", "ten") - 0.06),
  count2: snap(word("count", "six") - 0.06),
  count3: snap(word("count", "three") - 0.06),
  count4: snap(word("count", "one") - 0.06),
  panicA: at("panic"),
  panicB: snap(word("panic", "except") - 0.08),
  up: at("up"),
  cliffA: at("cliff"),
  cliffB: snap(T.duration + 0.12),
};
const duration = Math.ceil((T.duration + 1.2) * 2) / 2;
const marks = {
  popZero: word("zero", "zero"),
  popSeven: word("zeebra", "seven"),
  popNine: word("luna", "nine"),
  popTen: word("zip", "ten"),
  dropStart: word("night", "started"),
  upStart: word("up", "going"),
  name: word("cliff", "name"),
};
const events = [
  ...Object.entries(cuts).filter(([, t]) => t > 0).map(([id, t]) => ({ t, type: "whoosh", id })),
  ...["popZero", "popSeven", "popNine", "popTen"].map((k) => ({ t: marks[k], type: "pop", id: k })),
  { t: cuts.night, type: "hit", id: "night" },
  ...[1, 2, 3, 4].map((i) => ({ t: cuts["count" + i] + 0.06, type: "tick", id: "count" + i })),
  ...[0, 1, 2, 3, 4].map((i) => ({ t: marks.upStart + i * 0.22, type: "rise", id: "up" + i, n: i })),
  { t: cuts.cliffA, type: "hit", id: "tower" },
  { t: cuts.cliffB, type: "boom", id: "end" },
].sort((a, b) => a.t - b.t);

const plan = { fps: FPS, duration, voEnd: T.duration, cuts, marks, events };
writeFileSync(p("../story/plan.json"), JSON.stringify(plan, null, 1));
writeFileSync(p("../story/plan.js"), `window.STORY_PLAN = ${JSON.stringify(plan, null, 1)};\n`);
console.log("duration", duration, "shots", Object.keys(cuts).length);
const ks = Object.entries(cuts);
ks.forEach(([k, t], i) => console.log(k.padEnd(8), t.toFixed(2), ((ks[i + 1]?.[1] ?? duration) - t).toFixed(2)));
