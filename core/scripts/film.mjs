#!/usr/bin/env node
// One entry point for working on a film.   node core/scripts/film.mjs <command> <film>
//
//   new <film> ["Title"] [--series <id>]  scaffold outputs/<film>/ from core/template and series
//   narrate <film>        /my-editor voice-clone narration + word timings (cached per line)
//   voice <film>          legacy ElevenLabs narration + word timings (spends credits on text changes)
//   plan <film>           cut times, sound events and durations from the timings
//   audio <film>          synthesise music and sound effects
//   check <film>          HyperFrames lint
//   shots <film> [ids]    snapshot the middle frame of every shot (or of the listed cut ids)
//   render <film>         render outputs/<film>/renders/<film>.mp4
//   build <film>          narrate (or voice), plan, audio, check and render in order
//   assets                rebuild the shared GLB assets with Blender
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CORE, OUTPUTS, ROOT, filmDir } from "./lib.mjs";
import { resolveSeries } from "./series.mjs";

const HF = ["--yes", "hyperframes@0.9.22"];
const BLENDER = process.env.BLENDER || "/Applications/Blender.app/Contents/MacOS/Blender";
// the audio script needs numpy: use $PYTHON, or the first interpreter that has it
const PYTHON = process.env.PYTHON || ["python3", "python", "/opt/homebrew/bin/python3", "/opt/homebrew/opt/python@3.11/bin/python3.11", "/usr/local/bin/python3"]
  .find((py) => spawnSync(py, ["-c", "import numpy"], { stdio: "ignore" }).status === 0) || "python3";
const [cmd, name, ...rest] = process.argv.slice(2);

function run(bin, args, opts = {}) {
  const winNpx = process.platform === "win32" && bin === "npx";
  const r = spawnSync(winNpx ? "npx.cmd" : bin, args, { stdio: "inherit", cwd: ROOT, ...(winNpx ? { shell: true } : {}), ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
/** every film folder carries a "core" symlink so its page can load the shared engine and assets */
function link(dir) {
  const p = join(dir, "core");
  let present = false;
  try { lstatSync(p); present = true; } catch {}
  if (!present) {
    try { symlinkSync("../../core", p, "dir"); }
    catch (e) { if (process.platform === "win32") symlinkSync(CORE, p, "junction"); else throw e; }
  }
}
const steps = {
  new() {
    const dir = filmDir(name, { mustExist: false });
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    let seriesId = null;
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--series") { seriesId = rest[++i] || ""; continue; }
      if (rest[i].startsWith("--series=")) { seriesId = rest[i].slice("--series=".length); continue; }
      pos.push(rest[i]);
    }
    const series = resolveSeries(seriesId);
    const title = pos[0] || name;
    mkdirSync(join(dir, "story"), { recursive: true });
    mkdirSync(join(dir, "assets/audio"), { recursive: true });
    for (const f of ["index.html", "film.js", "hyperframes.json"]) cpSync(join(CORE, "template", f), join(dir, f));
    const narratorName = series.narrator?.name || "Pip";
    const narratorKey = series.narrator?.key || "pip";
    const story = JSON.parse(readFileSync(join(CORE, "template/story.json"), "utf8"));
    story.title = title;
    story.series = series.id;
    story.lang = "en";
    story.names = [...(series.names || [narratorName])];
    story.lines = story.lines.map((l) => ({
      ...l,
      text: String(l.text || "").replaceAll("__NARRATOR__", narratorName),
      big: Array.isArray(l.big) ? l.big.map((w) => w.replaceAll("__NARRATOR__", narratorName)) : l.big,
    }));
    writeFileSync(join(dir, "story/story.json"), JSON.stringify(story, null, 2) + "\n");
    writeFileSync(
      join(dir, "film.js"),
      readFileSync(join(dir, "film.js"), "utf8")
        .replaceAll("__FILM__", basename(dir))
        .replaceAll("__NARRATOR_KEY__", narratorKey)
        .replaceAll("__NARRATOR_NAME__", narratorName),
    );
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: basename(dir), name: basename(dir), series: series.id, createdAt: new Date().toISOString() }, null, 2) + "\n");
    link(dir);
    console.log(`Created ${dir} (series: ${series.id})\nNext: edit story/story.json and film.js, then run: npm run film build ${basename(dir)}`);
  },
  voice() { run("node", ["--env-file=.env.local", "core/scripts/tts.mjs", name]); },
  narrate() {
    // needs numpy, gradio_client and faster_whisper: use $NARRATE_PYTHON, or the first interpreter that has them
    const py = process.env.NARRATE_PYTHON || [PYTHON, "python3", "python", "/opt/homebrew/opt/python@3.11/bin/python3.11", "/opt/homebrew/bin/python3"]
      .find((p) => spawnSync(p, ["-c", "import numpy, gradio_client, faster_whisper"], { stdio: "ignore" }).status === 0) || "python3";
    run(py, ["core/scripts/narrate.py", name, ...rest]);
  },
  plan() { run("node", ["core/scripts/plan.mjs", name]); },
  audio() { run(PYTHON, ["core/scripts/audio.py", name]); },
  check() { const dir = filmDir(name); link(dir); run("npx", [...HF, "lint"], { cwd: dir }); },
  shots() {
    const dir = filmDir(name); link(dir);
    const p = JSON.parse(readFileSync(join(dir, "story/plan.json"), "utf8"));
    const ids = rest.length ? rest : p.order;
    const mids = ids.map((id) => {
      const i = p.order.indexOf(id);
      if (i < 0) throw new Error(`unknown cut id: ${id}`);
      return ((p.cuts[id] + (p.order[i + 1] ? p.cuts[p.order[i + 1]] : p.duration)) / 2).toFixed(2);
    });
    run("npx", [...HF, "snapshot", "--at", mids.join(","), "--no-end"], { cwd: dir });
  },
  render() {
    const dir = filmDir(name); link(dir);
    mkdirSync(join(dir, "renders"), { recursive: true });
    // extra flags pass through, e.g. `npm run film -- render <film> --workers 1` when disk space is short
    run("npx", [...HF, "render", "--quality", "looks", "-o", `renders/${basename(dir)}.mp4`, ...rest], { cwd: dir });
  },
  build() {
    // films with a "lang" in story.json use the /my-editor voice clone; older films keep ElevenLabs
    const story = JSON.parse(readFileSync(join(filmDir(name), "story/story.json"), "utf8"));
    for (const s of [story.lang ? "narrate" : "voice", "plan", "audio", "check", "render"]) steps[s]();
  },
  assets() { run(BLENDER, ["-b", "--factory-startup", "-P", "core/blender/build_assets.py", "--", "core/assets"]); },
};
if (!steps[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd ? 1 : 0);
}
try { steps[cmd](); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
