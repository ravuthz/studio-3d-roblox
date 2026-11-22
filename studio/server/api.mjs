// Film Studio API: reads outputs/<film>/ and runs core/scripts/film.mjs steps as jobs.
// Used as Vite middleware in dev (vite.config.ts) and by server/serve.mjs in production.
import { spawn, spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scenesText } from "../../core/scripts/scenes.mjs";
import { formatOf, listSeries, parseTopic, pickTopic, resolveSeries, slugify, topicPrompt } from "./topics.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUTS = join(ROOT, "outputs");
const FILM_CLI = join(ROOT, "core/scripts/film.mjs");
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CUT_ID = /^[A-Za-z0-9_.-]+$/;
const STEPS = new Set(["narrate", "voice", "plan", "audio", "check", "shots", "render", "build"]);
// only these folders of a film are served as media
const MEDIA_ROOTS = ["renders/", "assets/audio/", ".hyperframes/artifacts/snapshots/"];
const TYPES = { ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
// film styles: the registry in core/styles/styles.json, one folder per style (see AGENTS.md)
const STYLES_DIR = join(ROOT, "core/styles");
function styles() {
  const reg = readJson(join(STYLES_DIR, "styles.json")) || { default: "roblox", styles: [{ id: "roblox", label: "Roblox", description: "" }] };
  return reg.styles.map((s) => ({ id: s.id, label: s.label, description: s.description, aliases: s.aliases || [], default: s.id === reg.default }));
}
/** the style id for a name in story.json: aliases resolve, nothing or an unknown name gives the default */
function styleOf(name) {
  const all = styles();
  return (all.find((s) => s.id === name || s.aliases.includes(name)) || all.find((s) => s.default) || all[0]).id;
}
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return null; } };
const size = (p) => { try { return statSync(p).size; } catch { return null; } };

function filmNames() {
  if (!existsSync(OUTPUTS)) return [];
  return readdirSync(OUTPUTS, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && NAME.test(d.name) && existsSync(join(OUTPUTS, d.name, "story/story.json")))
    .map((d) => d.name)
    .sort();
}

/** newest snapshot run: its frames (time in seconds) and contact sheets */
function latestSnapshots(dir) {
  const base = join(dir, ".hyperframes/artifacts/snapshots");
  if (!existsSync(base)) return null;
  const runs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, at: mtime(join(base, d.name)) }))
    .sort((a, b) => b.at - a.at);
  // collect frames across runs, newest first, so a partial re-shoot of a few ids keeps the rest
  const byTime = new Map();
  for (const run of runs) {
    for (const f of readdirSync(join(base, run.id))) {
      const m = f.match(/^frame-\d+-at-([\d.]+)s\.png$/);
      if (!m) continue;
      const t = Number(m[1]);
      if (!byTime.has(t)) byTime.set(t, { t, path: `.hyperframes/artifacts/snapshots/${run.id}/${f}`, run: run.id, at: run.at });
    }
  }
  const frames = [...byTime.values()].sort((a, b) => a.t - b.t);
  return { runs: runs.length, updatedAt: runs[0]?.at ?? null, frames };
}

function summary(name, { full = false } = {}) {
  const dir = join(OUTPUTS, name);
  const story = readJson(join(dir, "story/story.json")) || { lines: [] };
  const plan = readJson(join(dir, "story/plan.json"));
  const meta = readJson(join(dir, "meta.json")) || {};
  const words = story.lines.reduce((n, l) => n + String(l.text || "").split(/\s+/).filter(Boolean).length, 0);
  const render = join(dir, "renders", `${name}.mp4`);
  const snaps = latestSnapshots(dir);
  const files = {
    story: mtime(join(dir, "story/story.json")),
    film: mtime(join(dir, "film.js")),
    vo: mtime(join(dir, "assets/audio/vo.mp3")),
    timing: mtime(join(dir, "story/timing.js")),
    plan: mtime(join(dir, "story/plan.json")),
    music: mtime(join(dir, "assets/audio/music.wav")),
    sfx: mtime(join(dir, "assets/audio/sfx.wav")),
    render: mtime(render),
    shots: snaps?.updatedAt ?? null,
  };
  const shots = plan?.order?.length ?? 0;
  const out = {
    name,
    title: story.title || name,
    series: story.series || null,
    lang: story.lang || null,
    style: styleOf(story.style),
    lines: story.lines.length,
    words,
    shots,
    duration: plan?.duration ?? null,
    voEnd: plan?.voEnd ?? null,
    avgShot: shots && plan?.voEnd ? plan.voEnd / shots : null,
    createdAt: meta.createdAt || null,
    renderSize: size(render),
    // a frame a third of the way in: past the title, before the ending
    thumb: snaps?.frames[Math.floor(snaps.frames.length / 3)]?.path ?? null,
    files,
    running: [...jobs.values()].some((j) => j.film === name && j.status === "running"),
  };
  if (full) {
    out.story = story;
    out.plan = plan ? { order: plan.order, cuts: plan.cuts, sections: plan.sections, duration: plan.duration, voEnd: plan.voEnd } : null;
    out.snapshots = snaps;
  }
  return out;
}

// ---------------------------------------------------------------- jobs
const jobs = new Map();
let seq = 0;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** a pipeline step: node core/scripts/film.mjs <step> <film> [args] */
function startStep(film, step, args = []) {
  return startJob(film, { step, args }, process.execPath, [FILM_CLI, step, film, ...args]);
}

function startJob(film, info, bin, argv) {
  if ([...jobs.values()].some((j) => j.film === film && j.status === "running")) {
    throw Object.assign(new Error(`A job is already running for ${film}`), { status: 409 });
  }
  const id = `${Date.now().toString(36)}-${++seq}`;
  const child = spawnBin(bin, argv, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let resolveDone;
  const done = new Promise((ok) => (resolveDone = ok));
  const job = { id, film, args: [], ...info, status: "running", code: null, startedAt: Date.now(), endedAt: null, lines: [], child, listeners: new Set(), done };
  let partial = "";
  const push = (text) => {
    const line = text.replace(ANSI, "");
    job.lines.push(line);
    if (job.lines.length > 5000) job.lines.splice(0, job.lines.length - 5000);
    for (const fn of job.listeners) fn({ type: "line", line });
  };
  const onData = (buf) => {
    const parts = (partial + buf.toString()).split(/\r\n|\n|\r/);
    partial = parts.pop();
    parts.forEach(push);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const finish = (code, signal) => {
    if (job.status !== "running") return;
    if (partial) push(partial);
    job.code = code;
    job.status = signal ? "stopped" : code === 0 ? "done" : "failed";
    job.endedAt = Date.now();
    job.child = null;
    for (const fn of job.listeners) fn({ type: "end", job: publicJob(job) });
    job.listeners.clear();
    resolveDone(job);
  };
  child.on("error", (e) => { push(`✗ ${bin}: ${e.message}`); finish(1, null); });
  child.on("close", finish);
  jobs.set(id, job);
  // keep the 50 most recent jobs
  const ids = [...jobs.keys()];
  for (const old of ids.slice(0, Math.max(0, ids.length - 50))) if (jobs.get(old).status !== "running") jobs.delete(old);
  for (const fn of jobHooks) fn(job);
  return job;
}
/** called with every new job (the autopilot CLI uses it to print logs) */
export const jobHooks = new Set();
const publicJob = ({ child, listeners, lines, done, ...j }) => ({ ...j, lineCount: lines.length });

// ---------------------------------------------------------------- AI agents
// STUDIO_AGENTS picks which agents "New film" offers, in order (default: agy,codex,claude).
// Each runs headless in the repo root and may only edit files, so it writes the story and the
// shot list but cannot run narration or renders.
// Each agent: its command (model null = the CLI's own default) and how to list its models.
// STUDIO_MODELS_<AGENT> (e.g. STUDIO_MODELS_CLAUDE=opus,sonnet) replaces the listed models.
const AGENTS = {
  agy: {
    bin: "agy",
    run: (prompt, model) => ["--mode", "accept-edits", "--print-timeout", "30m", ...(model ? ["--model", model] : []), "-p", prompt],
    ask: (prompt, model) => ["--mode", "plan", "--disable-slash-commands", "--print-timeout", "120s", ...(model ? ["--model", model] : []), "-p", prompt],
    // `agy models` prints "<id>\t<label>" lines
    list: async () => (await capture("agy", ["models"])).split("\n").map((l) => l.split("\t")).filter(([id, label]) => id && label && /^[\w.-]+$/.test(id)).map(([id, label]) => ({ id, label: label.trim() })),
  },
  codex: {
    bin: "codex",
    run: (prompt, model) => ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "-C", ROOT, ...(model ? ["-m", model] : []), prompt],
    ask: (prompt, model) => ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "-C", ROOT, ...(model ? ["-m", model] : []), prompt],
    // `codex debug models` prints the model catalog as JSON; keep the ones its picker lists
    list: async () => JSON.parse(await capture("codex", ["debug", "models"])).models.filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, label: m.display_name })),
  },
  claude: {
    bin: "claude",
    run: (prompt, model) => ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep", ...(model ? ["--model", model] : [])],
    ask: (prompt, model) => ["-p", prompt, "--tools", "", ...(model ? ["--model", model] : [])],
    // no listing command: the CLI's aliases always point at the latest model of each family
    list: async () => [
      { id: "opus", label: "Opus (latest)" },
      { id: "sonnet", label: "Sonnet (latest)" },
      { id: "haiku", label: "Haiku (latest)" },
      { id: "fable", label: "Fable (latest)" },
    ],
  },
};

function which(bin) {
  if (process.platform === "win32") {
    const r = spawnSync("where.exe", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (r.status !== 0) return null;
    const paths = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return paths.find((p) => /\.(exe|com)$/i.test(p)) || paths[0] || null;
  }
  const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout.trim() || null : null;
}
const installed = (bin) => Boolean(which(bin));

function spawnBin(bin, argv, opts) {
  const exe = which(bin) || bin;
  const cmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(exe);
  const args = cmdShim ? argv.map((a) => String(a).replace(/\r?\n+/g, " ")) : argv;
  return spawn(exe, args, cmdShim ? { ...opts, shell: true } : opts);
}

/** stdout of a short command, or a rejection after timeoutMs */
function capture(bin, argv, timeoutMs = 30000) {
  return new Promise((ok, fail) => {
    const child = spawnBin(bin, argv, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    const timer = setTimeout(() => { child.kill(); fail(new Error(`${bin} timed out`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); fail(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? ok(out) : fail(new Error(`${bin} exited ${code}`)); });
  });
}

// model lists are slow to fetch (agy asks its server), so keep them for 10 minutes
const modelCache = new Map();
async function models(name) {
  const override = process.env[`STUDIO_MODELS_${name.toUpperCase()}`];
  if (override) return override.split(",").map((m) => m.trim()).filter((m) => /^[\w.:/-]+$/.test(m)).map((id) => ({ id, label: id }));
  const hit = modelCache.get(name);
  if (hit && Date.now() - hit.at < 600000) return hit.list;
  const list = await AGENTS[name].list().catch(() => []);
  if (list.length) modelCache.set(name, { at: Date.now(), list });
  return list;
}

export async function agents() {
  const names = (process.env.STUDIO_AGENTS || "agy,codex,claude").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  return Promise.all(
    [...new Set(names)].filter((n) => AGENTS[n]).map(async (name) => {
      const ok = installed(AGENTS[name].bin);
      return { name, installed: ok, models: ok ? await models(name) : [] };
    }),
  );
}

/** a free folder name for an agent film whose name was left empty: from the title, else the idea, else the date */
function autoName(title, idea) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const base = slugify(title) || slugify(idea, 5) || `film-${stamp}`;
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base.slice(0, 58)}-${i}`;
    if (NAME.test(name) && !existsSync(join(OUTPUTS, name))) return name;
  }
}

function resolveSeriesOr400(id) {
  try { return resolveSeries(id); }
  catch (e) { throw Object.assign(e, { status: 400 }); }
}

function storyPrompt({ name, title, lang, style, idea, series }) {
  const km = lang === "km";
  const look = styles().find((x) => x.id === styleOf(style));
  const s = resolveSeriesOr400(series);
  const fmt = formatOf(s);
  const castDesc = (s.cast || []).map((c) => `A.${c.key} = ${c.name} (${c.role})`).join(", ");
  const dogs = (s.cast || []).filter((c) => c.dog).map((c) => `A.${c.key}`);
  const dogNote = dogs.length
    ? ` ${dogs.join(", ")} is a dog actor: only the dog clips (Idle, Walk, Run, Sit, Bark, Beg, Sleep) and dog faces (neutral, happy, sad, shock, sleep), placed with put() or place().pose().face() like the others.`
    : "";
  return `You are writing a new film in this repository of 3D story films. The folder outputs/${name}/ was just scaffolded from core/template for the "${s.label}" series and still holds the template story and shots.

Film folder: outputs/${name}
Series: ${s.label} ("series": "${s.id}")
Title: ${title || "none given: choose a short, catchy title that fits the story and set it as \"title\" in story.json"}
Language: ${km ? 'Khmer ("lang": "km")' : 'English ("lang": "en")'}
Style: ${look.label} ("style": "${look.id}", already set in story.json; keep it). ${look.description} Read the "Styles" section of AGENTS.md for its framing notes.
Idea: ${idea || (title ? "Invent an original story that fits the title." : "Invent an original story.")}

Places to stage it. Built-in sets: home (family living room + kitchen, HM / CAM_HOME / HOME_SEATS), cafe (lover, CF / CAM_CAFE / CAFE_SEATS), town, house, room, forest, highway (SUV cabin). Kit scenes (env "<id> day|dusk|night", use const S = useScene("<id>") then S.shot(t, u, cam), S.sit(actor, seat, clip, t, face), S.put(actor, mark, clip, t, face), S.frame(...)):
${scenesText(s.id) || "none"}
Use these existing places. Only if the story truly needs a place none of them can play, add ONE new layout core/scenes/<id>.json built only from kit props (see "Scene kit" in AGENTS.md; no engine code) — that file is the only allowed change outside the film folder.

Steps:
1. Read AGENTS.md (rules, story.json fields, engine reference and lessons), core/series/${s.id}.json, the exports of core/engine/stage.js, and one finished film as a reference: outputs/road-trip-playlist/story/story.json and outputs/road-trip-playlist/film.js.
2. Write outputs/${name}/story/story.json: 62–75 seconds of first-person narration (never under 61 s: TikTok only monetizes videos over a minute) by ${s.narrator.name} (${km ? "Khmer text sized to 62–75 seconds when spoken" : "about 175–200 English words"}) in the ${fmt.label} format. ${fmt.shape} Add "cuts" words so shots average 1.6–2.1 s, and use "big", "mood", "hits", "pops", "flash" and "sfx" where they help. ${title ? "Keep the title" : "Set the title you chose"}, set "series": "${s.id}", "names" (include ${JSON.stringify(s.names)} plus any other proper names captions must keep capitalised) and "lang": "${km ? "km" : "en"}".
3. Write outputs/${name}/film.js: one staged shot for every cut id (each line id, "<id>.1", "<id>.2"… for its cuts, and "tail"). Every shot gets a camera move and uses only what core/stage.js exports.${dogNote} Film-only characters go in "cast", film-only helpers stay in film.js. Shots must be pure functions of t (no Math.random, no clocks).

Rules: change only files inside outputs/${name}/ (plus at most one new core/scenes/<id>.json, as above). Do not run narrate, voice, plan, audio, shots or render, and do not change other core/ files, voices/ or other films. Never read .env.local. The story is original. Use ONLY this series' cast: ${castDesc}. Do NOT use the old family (Zero, Zeebra, Luna, Zip).

When you finish, print a short summary: number of lines, words and cuts, and the main characters.`;
}

function startAgent(film, agent, model, opts) {
  const a = AGENTS[agent];
  return startJob(film, { step: "write", agent, model }, a.bin, a.run(storyPrompt({ name: film, ...opts }), model));
}

/** checks agent and model against STUDIO_AGENTS and the installed CLIs; returns an error message or null */
async function agentError(agent, model) {
  const a = (await agents()).find((x) => x.name === agent);
  if (!a) return `Agent ${agent} is not allowed (STUDIO_AGENTS)`;
  if (!a.installed) return `${agent} is not installed on this machine`;
  if (model && !a.models.some((m) => m.id === model)) return `Model ${model} is not offered for ${agent}`;
  return null;
}

/** names and titles already used, so a new topic does not repeat one */
function takenTopics(avoid = []) {
  const existing = filmNames();
  const existingTitles = existing.map((n) => readJson(join(OUTPUTS, n, "story/story.json"))?.title).filter(Boolean);
  const avoidList = Array.isArray(avoid) ? avoid.filter((x) => typeof x === "string").slice(0, 100) : [];
  const takenNames = new Set([...existing, ...avoidList.map((s) => (NAME.test(s) ? s : slugify(s, 5))).filter(Boolean)]);
  const takenTitles = new Set([...existingTitles, ...avoidList].map((s) => s.trim().toLowerCase()).filter(Boolean));
  return { takenNames, takenTitles };
}

/** a topic from the agent (read-only), or from the built-in list */
async function nextTopic({ agent = null, model = null, avoid = [], series = null } = {}) {
  const s = resolveSeriesOr400(series);
  const { takenNames, takenTitles } = takenTopics(avoid);
  if (!agent) return { ...pickTopic({ series: s.id, takenNames, takenTitles }), source: "builtin" };
  const prompt = topicPrompt({ series: s.id, takenNames: [...takenNames], takenTitles: [...takenTitles] });
  const out = await capture(AGENTS[agent].bin, AGENTS[agent].ask(prompt, model || null), 120000);
  return { ...parseTopic(out, takenNames), series: s.id, source: agent };
}

/** npm run film new, then "series" + "lang" in story.json and the idea in meta.json */
function scaffold({ name, title, lang, idea = "", series = null, style = null }) {
  const s = resolveSeriesOr400(series);
  const look = styleOf(style);
  const r = spawnSync(process.execPath, [FILM_CLI, "new", name, title || name, "--series", s.id, "--style", look], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw Object.assign(new Error((r.stderr || r.stdout).trim()), { status: 500 });
  // new films use the /my-editor voice clone, picked by "lang"
  const storyPath = join(OUTPUTS, name, "story/story.json");
  writeFileSync(storyPath, JSON.stringify({ ...readJson(storyPath), series: s.id, lang, style: look }, null, 2) + "\n");
  if (idea.trim()) {
    const metaPath = join(OUTPUTS, name, "meta.json");
    writeFileSync(metaPath, JSON.stringify({ ...readJson(metaPath), series: s.id, idea: idea.trim() }, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------- autopilot
// topic -> scaffold -> agent writes story.json and film.js -> build (narrate, plan, audio, check, render),
// for `count` films (0 = until stopped), without asking for confirmation at any step.
// Up to `parallel` agents write films at the same time; builds run one at a time (the render fills the CPU).
let auto = null;
const publicAuto = () => auto && { ...auto, done: undefined, running: undefined, signal: undefined, job: auto.job ? publicJob(auto.job) : null, log: auto.log.slice(-200) };

export function autoState() { return publicAuto(); }

export async function startAuto({ agent = null, model = null, lang = "en", count = 1, parallel = 3, topicAgent = true, series = null, style = null } = {}) {
  if (auto?.status === "running") throw Object.assign(new Error("Autopilot is already running"), { status: 409 });
  if (!["en", "km"].includes(lang)) throw Object.assign(new Error("lang must be en or km"), { status: 400 });
  const s = resolveSeriesOr400(series);
  if (style != null && !styles().some((x) => x.id === style)) throw Object.assign(new Error(`Unknown style: ${style}`), { status: 400 });
  count = Math.max(0, Math.min(50, Number.isFinite(+count) ? Math.floor(+count) : 1));
  parallel = Math.max(1, Math.min(6, Number.isFinite(+parallel) ? Math.floor(+parallel) : 3));
  if (count) parallel = Math.min(parallel, count);
  // the story needs an agent: the given one, else the first installed one
  if (!agent) agent = (await agents()).find((a) => a.installed)?.name;
  if (!agent) throw Object.assign(new Error("No AI agent is installed (STUDIO_AGENTS)"), { status: 400 });
  const err = await agentError(agent, model);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const state = { status: "running", agent, model, lang, series: s.id, style: styleOf(style), count, parallel, running: new Set(), signal: null, phase: "topic", film: null, job: null, films: [], log: [], startedAt: Date.now(), endedAt: null, stopping: false };
  auto = state;
  state.done = runAuto(state, { topicAgent })
    .catch((e) => note(state, `✗ ${e.message}`))
    .finally(() => {
      state.status = state.stopping ? "stopped" : "done";
      state.phase = null;
      state.job = null;
      state.endedAt = Date.now();
      note(state, `autopilot ${state.status}: ${state.films.filter((f) => f.status === "done").length} of ${state.films.length} films rendered`);
    });
  return publicAuto();
}

/** resolves when the running autopilot ends (the CLI waits on it) */
export const autoDone = () => auto?.done ?? Promise.resolve();

export function stopAuto() {
  if (auto?.status !== "running") return publicAuto();
  auto.stopping = true;
  for (const job of auto.running) job.child?.kill("SIGTERM");
  auto.signal?.();
  return publicAuto();
}

function note(state, line) {
  state.log.push(line);
  if (state.log.length > 1000) state.log.splice(0, state.log.length - 1000);
  for (const fn of autoHooks) fn(line);
}
/** called with every autopilot log line (the CLI prints them) */
export const autoHooks = new Set();

async function runAuto(state, { topicAgent }) {
  const seen = [];
  const queue = []; // written films waiting for their build
  let started = 0;
  let failures = 0;
  let writers = state.parallel;
  let waiters = [];
  const signal = (state.signal = () => waiters.splice(0).forEach((fn) => fn()));
  const wait = () => new Promise((ok) => waiters.push(ok));
  const more = () => !state.stopping && failures < 3 && (state.count === 0 || started < state.count);

  // state.job / film / phase follow the build when one runs, else the newest writer
  const focus = () => {
    const list = [...state.running];
    const job = list.find((j) => j.step === "build") ?? list.at(-1) ?? null;
    state.job = job;
    state.film = job?.film ?? null;
    state.phase = job ? (job.step === "build" ? "build" : "write") : "topic";
  };
  const track = (job) => {
    state.running.add(job);
    focus();
    job.done.then(() => { state.running.delete(job); focus(); });
    return job;
  };
  const fail = (entry, why) => {
    entry.status = state.stopping ? "stopped" : "failed";
    entry.step = null;
    note(state, `✗ ${entry.name}: ${why}`);
    if (!state.stopping && ++failures === 3) note(state, "three films failed in a row: no new films are started");
    signal();
  };

  // topic + scaffold, one writer at a time so two films never get the same topic
  let lock = Promise.resolve();
  const claim = () => {
    const p = lock.then(async () => {
      if (!more()) return null;
      started++;
      let topic;
      try {
        topic = await nextTopic({ agent: topicAgent ? state.agent : null, model: state.model, avoid: seen, series: state.series });
      } catch (e) {
        note(state, `topic from ${state.agent} failed (${e.message}); using the built-in list`);
        topic = await nextTopic({ avoid: seen, series: state.series });
      }
      if (state.stopping) return null;
      const name = autoName(topic.name, topic.idea);
      seen.push(name, topic.title);
      const entry = { name, title: topic.title, idea: topic.idea, source: topic.source, status: "running", step: "new" };
      state.films.push(entry);
      note(state, `▶ ${name}: ${topic.title} (${state.series}, ${topic.source})`);
      scaffold({ name, title: topic.title, lang: state.lang, idea: topic.idea, series: state.series, style: state.style });
      return entry;
    });
    lock = p.catch(() => {});
    return p;
  };

  // the agent writes story.json and film.js, then the film joins the build queue
  const writer = async () => {
    try {
      for (;;) {
        while (queue.length >= state.parallel && more()) await wait();
        const entry = await claim();
        if (!entry) return;
        entry.step = "write";
        const storyPath = join(OUTPUTS, entry.name, "story/story.json");
        const before = readFileSync(storyPath, "utf8");
        const job = track(startAgent(entry.name, state.agent, state.model, { title: entry.title, lang: state.lang, style: state.style, idea: entry.idea, series: state.series }));
        await job.done;
        const wrote = job.status === "done" && readFileSync(storyPath, "utf8") !== before && readJson(storyPath)?.lines?.length > 0;
        if (!wrote) { fail(entry, `the agent ${job.status === "done" ? "did not write story.json" : job.status}`); continue; }
        entry.step = "queued";
        queue.push(entry);
        signal();
      }
    } catch (e) {
      note(state, `✗ ${e.message}`);
      failures = 3;
    } finally {
      writers--;
      signal();
    }
  };

  // narrate -> plan -> audio -> check -> render, one film at a time
  const builder = async () => {
    for (;;) {
      while (!queue.length && writers > 0) await wait();
      if (state.stopping || !queue.length) return;
      const entry = queue.shift();
      signal();
      entry.step = "build";
      const job = track(startStep(entry.name, "build"));
      await job.done;
      if (job.status !== "done") { fail(entry, `build ${job.status}`); continue; }
      failures = 0;
      entry.status = "done";
      entry.step = null;
      entry.render = `outputs/${entry.name}/renders/${entry.name}.mp4`;
      note(state, `✓ ${entry.name}: ${entry.render}`);
    }
  };

  await Promise.all([...Array.from({ length: state.parallel }, writer), builder()]);
  for (const f of state.films) if (f.status === "running") { f.status = "stopped"; f.step = null; }
}

// ---------------------------------------------------------------- http
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) throw Object.assign(new Error("Body too large"), { status: 413 }); }
  return raw ? JSON.parse(raw) : {};
}

function serveMedia(req, res, film, rel, download = false) {
  const dir = join(OUTPUTS, film);
  // posix paths on every OS: on Windows normalize() gives backslashes, which never match MEDIA_ROOTS
  const clean = posix.normalize(rel.replace(/\\/g, "/")).replace(/^(\.\.(\/|$))+/, "").replace(/^\/+/, "");
  if (!MEDIA_ROOTS.some((r) => clean.startsWith(r))) return send(res, 404, { error: "Not found" });
  const file = resolve(dir, clean);
  if (!file.startsWith(dir + sep) || !existsSync(file)) return send(res, 404, { error: "Not found" });
  const { size: total } = statSync(file);
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const head = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  // ?download asks the browser to save the file instead of playing it (iOS/Safari players have no download button)
  if (download) head["content-disposition"] = `attachment; filename="${basename(file).replace(/[^\w.-]/g, "_")}"`;
  // stream the bytes, and stop reading when the viewer seeks away or closes the tab
  const stream = (opts) => {
    if (req.method === "HEAD") return res.end();
    const s = createReadStream(file, opts);
    res.on("close", () => s.destroy());
    s.on("error", () => res.destroy());
    s.pipe(res);
  };
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) { res.writeHead(416, { "content-range": `bytes */${total}` }); return res.end(); }
    res.writeHead(206, { ...head, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${total}` });
    return stream({ start, end });
  }
  res.writeHead(200, { ...head, "content-length": total });
  stream();
}

// HTTP basic auth for every request (app, API and media) when STUDIO_AUTH_USER and
// STUDIO_AUTH_PASSWORD are set in studio/.env; off when either is empty.
const sha = (s) => createHash("sha256").update(s).digest();
function authorized(req) {
  const user = process.env.STUDIO_AUTH_USER, pass = process.env.STUDIO_AUTH_PASSWORD;
  if (!user || !pass) return true;
  const m = (req.headers.authorization || "").match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1], "base64").toString("utf8");
  // compare hashes so lengths match and the check takes the same time whatever was sent
  return timingSafeEqual(sha(given), sha(`${user}:${pass}`));
}

/** Connect-style handler: answers /api/* and /media/*, calls next() for anything else. */
export async function handler(req, res, next) {
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Film Studio", charset="UTF-8"', "content-type": "text/plain" });
    return res.end("Authentication required");
  }
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p.startsWith("/media/")) {
      const [, , film, ...rest] = p.split("/");
      if (!NAME.test(film)) return send(res, 404, { error: "Not found" });
      return serveMedia(req, res, film, decodeURIComponent(rest.join("/")), url.searchParams.has("download"));
    }
    if (!p.startsWith("/api/")) return next?.();

    if (p === "/api/films" && req.method === "GET") return send(res, 200, filmNames().map((n) => summary(n)));

    if (p === "/api/agents" && req.method === "GET") return send(res, 200, await agents());

    if (p === "/api/styles" && req.method === "GET") return send(res, 200, styles());
    let sm = p.match(/^\/api\/styles\/([a-z0-9-]+)\/preview$/);
    if (sm && req.method === "GET") {
      const file = join(STYLES_DIR, sm[1], "preview.png");
      if (!styles().some((x) => x.id === sm[1]) || !existsSync(file)) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": "image/png", "content-length": statSync(file).size, "cache-control": "no-cache" });
      return createReadStream(file).pipe(res);
    }

    if (p === "/api/series" && req.method === "GET") {
      return send(res, 200, listSeries().map(({ id, label, narrator, cast, format }) => ({ id, label, narrator, cast, format })));
    }

    if (p === "/api/topic" && req.method === "POST") {
      const { agent = null, model = null, avoid = [], series = null } = await body(req);
      if (agent) {
        const err = await agentError(agent, model);
        if (err) return send(res, 400, { error: err });
      }
      return send(res, 200, await nextTopic({ agent, model, avoid, series }));
    }

    if (p === "/api/auto" && req.method === "GET") return send(res, 200, autoState());
    if (p === "/api/auto" && req.method === "POST") return send(res, 202, await startAuto(await body(req)));
    if (p === "/api/auto/stop" && req.method === "POST") return send(res, 200, stopAuto());

    if (p === "/api/films" && req.method === "POST") {
      const { name: rawName, title: rawTitle, lang = "en", style: rawStyle = null, agent = null, model = null, idea: rawIdea = "", series = null } = await body(req);
      const idea = String(rawIdea || "").slice(0, 4000);
      const given = String(rawTitle || "").trim().slice(0, 200);
      // with an agent the folder name and title may be left empty: the name comes from the title or idea, the agent picks the title
      const name = rawName ? String(rawName) : agent ? autoName(given, idea) : "";
      if (!NAME.test(name || "")) return send(res, 400, { error: "Use lowercase letters, numbers and dashes for the name" });
      if (existsSync(join(OUTPUTS, name))) return send(res, 409, { error: `outputs/${name} already exists` });
      if (!["en", "km"].includes(lang)) return send(res, 400, { error: "lang must be en or km" });
      const style = rawStyle == null ? styleOf() : styles().find((x) => x.id === rawStyle)?.id;
      if (!style) return send(res, 400, { error: `Unknown style: ${rawStyle}` });
      const s = resolveSeriesOr400(series);
      if (agent) {
        const err = await agentError(agent, model);
        if (err) return send(res, 400, { error: err });
      }
      scaffold({ name, title: given || name, lang, idea, series: s.id, style });
      const job = agent ? publicJob(startAgent(name, agent, model || null, { title: given || null, lang, style, idea, series: s.id })) : null;
      return send(res, 201, { film: summary(name), job });
    }

    let m = p.match(/^\/api\/films\/([^/]+)$/);
    if (m && req.method === "GET") {
      if (!filmNames().includes(m[1])) return send(res, 404, { error: "No such film" });
      return send(res, 200, summary(m[1], { full: true }));
    }

    // change a film's style: rewrite "style" in story.json (the text is edited in place, so the
    // file keeps its layout), then re-run plan so plan.js carries it to the engine
    if (m && req.method === "PATCH") {
      const film = m[1];
      if (!filmNames().includes(film)) return send(res, 404, { error: "No such film" });
      const { style: want } = await body(req);
      const style = styles().find((x) => x.id === want)?.id;
      if (!style) return send(res, 400, { error: `Unknown style: ${want}` });
      const storyPath = join(OUTPUTS, film, "story/story.json");
      let text = readFileSync(storyPath, "utf8");
      if (/"style"\s*:\s*"[^"]*"/.test(text)) text = text.replace(/"style"\s*:\s*"[^"]*"/, `"style": "${style}"`);
      else text = text.replace(/\{(\s*)/, (_, ws) => `{${ws}"style": "${style}",${ws}`);
      JSON.parse(text); // never write a broken story
      // keep the file's date: the narration does not depend on the style, so it must not show as out of date
      const { atime, mtime: was } = statSync(storyPath);
      writeFileSync(storyPath, text);
      utimesSync(storyPath, atime, was);
      const planned = existsSync(join(OUTPUTS, film, "story/timing.js"));
      return send(res, 200, { film: summary(film), job: planned ? publicJob(startStep(film, "plan")) : null });
    }

    m = p.match(/^\/api\/films\/([^/]+)\/run$/);
    if (m && req.method === "POST") {
      const film = m[1];
      if (!filmNames().includes(film)) return send(res, 404, { error: "No such film" });
      const { step, args = [] } = await body(req);
      if (!STEPS.has(step)) return send(res, 400, { error: `Unknown step: ${step}` });
      if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || !CUT_ID.test(a))) return send(res, 400, { error: "Bad arguments" });
      return send(res, 202, publicJob(startStep(film, step, args)));
    }

    // open the outputs/ folder in the system file manager (the server only listens on 127.0.0.1)
    if (p === "/api/open" && req.method === "POST") {
      const [bin, args] = process.platform === "darwin" ? ["open", [OUTPUTS]]
        : process.platform === "win32" ? ["explorer", [OUTPUTS]]
        : ["xdg-open", [OUTPUTS]];
      const child = spawn(bin, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return send(res, 200, { opened: OUTPUTS });
    }

    if (p === "/api/jobs" && req.method === "GET") {
      const film = url.searchParams.get("film");
      return send(res, 200, [...jobs.values()].filter((j) => !film || j.film === film).map(publicJob).reverse());
    }

    m = p.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (m && req.method === "GET") {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "No such job" });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      const emit = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      emit({ type: "init", job: publicJob(job), lines: job.lines });
      if (job.status !== "running") { emit({ type: "end", job: publicJob(job) }); return res.end(); }
      const fn = (ev) => { emit(ev); if (ev.type === "end") res.end(); };
      job.listeners.add(fn);
      req.on("close", () => job.listeners.delete(fn));
      return;
    }

    m = p.match(/^\/api\/jobs\/([^/]+)\/stop$/);
    if (m && req.method === "POST") {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "No such job" });
      job.child?.kill("SIGTERM");
      return send(res, 200, publicJob(job));
    }

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
}
