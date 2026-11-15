#!/usr/bin/env node
// One entry point for working on a film.   node core/scripts/film.mjs <command> <film>
//
//   new <film> ["Title"]  scaffold outputs/<film>/ from core/template
//   voice <film>          ElevenLabs narration + word timings (cached; spends credits on text changes)
//   plan <film>           cut times, sound events and durations from the timings
//   audio <film>          synthesise music and sound effects
//   check <film>          HyperFrames lint
//   shots <film> [ids]    snapshot the middle frame of every shot (or of the listed cut ids)
//   render <film>         render outputs/<film>/renders/<film>.mp4
//   build <film>          voice, plan, audio, check and render in order
//   assets                rebuild the shared GLB assets with Blender
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CORE, OUTPUTS, ROOT, filmDir } from "./lib.mjs";

const HF = ["--yes", "hyperframes@0.9.22"];
const BLENDER = process.env.BLENDER || "/Applications/Blender.app/Contents/MacOS/Blender";
// the audio script needs numpy: use $PYTHON, or the first interpreter that has it
const PYTHON = process.env.PYTHON || ["python3", "/opt/homebrew/bin/python3", "/opt/homebrew/opt/python@3.11/bin/python3.11", "/usr/local/bin/python3"]
  .find((py) => spawnSync(py, ["-c", "import numpy"], { stdio: "ignore" }).status === 0) || "python3";
const [cmd, name, ...rest] = process.argv.slice(2);

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
/** every film folder carries a "core" symlink so its page can load the shared engine and assets */
function link(dir) {
  const p = join(dir, "core");
  let present = false;
  try { lstatSync(p); present = true; } catch {}
  if (!present) symlinkSync("../../core", p, "dir");
}
const steps = {
  new() {
    const dir = filmDir(name, { mustExist: false });
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    const title = rest[0] || name;
    mkdirSync(join(dir, "story"), { recursive: true });
    mkdirSync(join(dir, "assets/audio"), { recursive: true });
    for (const f of ["index.html", "film.js", "hyperframes.json"]) cpSync(join(CORE, "template", f), join(dir, f));
    const story = JSON.parse(readFileSync(join(CORE, "template/story.json"), "utf8"));
    story.title = title;
    writeFileSync(join(dir, "story/story.json"), JSON.stringify(story, null, 2) + "\n");
    writeFileSync(join(dir, "film.js"), readFileSync(join(dir, "film.js"), "utf8").replaceAll("__FILM__", basename(dir)));
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: basename(dir), name: basename(dir), createdAt: new Date().toISOString() }, null, 2) + "\n");
    link(dir);
    console.log(`Created ${dir}\nNext: edit story/story.json and film.js, then run: npm run film build ${basename(dir)}`);
  },
  voice() { run("node", ["--env-file=.env.local", "core/scripts/tts.mjs", name]); },
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
    run("npx", [...HF, "render", "--quality", "looks", "-o", `renders/${basename(dir)}.mp4`], { cwd: dir });
  },
  build() { for (const s of ["voice", "plan", "audio", "check", "render"]) steps[s](); },
  assets() { run(BLENDER, ["-b", "--factory-startup", "-P", "core/blender/build_assets.py", "--", "core/assets"]); },
};
if (!steps[cmd]) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd ? 1 : 0);
}
try { steps[cmd](); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
