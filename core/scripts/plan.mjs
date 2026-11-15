// Turns word timings into the edit plan: cut times, sound events, moods, total length.
//
// story.json line fields:
//   id, text        every line starts a shot with cut id "<id>"
//   cuts: [word]    words that start further shots: "<id>.1", "<id>.2", ...
//   big: [word]     caption words shown larger
//   marks: {n: w}   named times (start of word w) for the film code: plan.marks.n
//   hits / pops / flash: [k]   sound hit, pop or white flash on cut k of the line (0 = line start)
//   sfx: [[type, at]]          extra sounds; at = a word or a cut index; type = pop | tick | hit | rises
//   mood            music mood from this line on: day | warm | dark | tense
// A final "tail" shot follows the narration. Also updates title and durations in index.html.
// Run from the project root:  node core/scripts/plan.mjs <film>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { bare, filmDir } from "./lib.mjs";

const dir = filmDir(process.argv[2]);
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(dir, "story/timing.js"), "utf8"), ctx);
const T = ctx.window.STORY_TIMING;
const story = JSON.parse(readFileSync(join(dir, "story/story.json"), "utf8"));
const FPS = 30;
const snap = (t) => Math.round(t * FPS) / FPS;
const LEAD = 0.1; // picture cuts slightly before the phrase lands

const cuts = {}, order = [], events = [], sections = [], flashes = [], marks = {};
story.lines.forEach((line, li) => {
  const words = T.words.filter((w) => w.line === li);
  const wordAt = (w, from = 0) => {
    const idx = words.findIndex((x, i) => i >= from && bare(x.w) === bare(w));
    if (idx < 0) throw new Error(`word not found: ${line.id}/${w}`);
    return idx;
  };
  const ids = [line.id];
  const times = [li === 0 ? 0 : snap(Math.max(0, words[0].s - LEAD))];
  let from = 1;
  (line.cuts || []).forEach((cw, k) => {
    const idx = wordAt(cw, from);
    from = idx + 1;
    ids.push(`${line.id}.${k + 1}`);
    times.push(snap(words[idx].s - 0.07));
  });
  ids.forEach((id, k) => {
    cuts[id] = times[k];
    order.push(id);
    if (times[k] > 0) events.push({ t: times[k], type: "whoosh", id });
  });
  (line.hits || []).forEach((k) => events.push({ t: times[k], type: "hit", id: ids[k] }));
  (line.pops || []).forEach((k) => events.push({ t: times[k] + 0.12, type: "pop", id: ids[k] }));
  (line.flash || []).forEach((k) => flashes.push(times[k]));
  for (const [name, w] of Object.entries(line.marks || {})) marks[name] = words[wordAt(w)].s;
  (line.sfx || []).forEach(([type, at]) => {
    const t = typeof at === "number" ? times[at] + 0.06 : words[wordAt(at)].s;
    if (type === "rises") for (let n = 0; n < 5; n++) events.push({ t: t + n * 0.22, type: "rise", id: `${line.id}.rise${n}`, n });
    else events.push({ t, type, id: `${line.id}.${type}` });
  });
  if (line.mood) sections.push({ t: times[0], mood: line.mood });
});
cuts.tail = snap(T.duration + 0.12);
order.push("tail");
events.push({ t: cuts.tail, type: "boom", id: "tail" });
flashes.push(cuts.tail);
const duration = Math.ceil((T.duration + 1.4) * 2) / 2;
events.sort((a, b) => a.t - b.t);

const plan = { title: story.title, names: story.names || [], fps: FPS, duration, voEnd: T.duration, cuts, order, marks, events, sections, flashes };
writeFileSync(join(dir, "story/plan.json"), JSON.stringify(plan, null, 1));
writeFileSync(join(dir, "story/plan.js"), `window.STORY_PLAN = ${JSON.stringify(plan, null, 1)};\n`);

const html = join(dir, "index.html");
if (existsSync(html)) {
  let s = readFileSync(html, "utf8");
  s = s.replace(/data-duration="[\d.]+"/g, `data-duration="${duration}"`);
  s = s.replace(/<title>[^<]*<\/title>/, `<title>${story.title}</title>`);
  writeFileSync(html, s);
}
const lens = order.map((id, i) => (order[i + 1] ? cuts[order[i + 1]] : duration) - cuts[id]);
console.log(`duration ${duration} s, ${order.length} shots, average ${(duration / order.length).toFixed(2)} s, shortest ${Math.min(...lens).toFixed(2)} s, longest ${Math.max(...lens).toFixed(2)} s`);
