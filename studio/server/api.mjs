// Film Studio API: reads outputs/<film>/ and runs core/scripts/film.mjs steps as jobs.
// Used as Vite middleware in dev (vite.config.ts) and by server/serve.mjs in production.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  const child = spawn(bin, argv, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const job = { id, film, args: [], ...info, status: "running", code: null, startedAt: Date.now(), endedAt: null, lines: [], child, listeners: new Set() };
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
  };
  child.on("error", (e) => { push(`✗ ${bin}: ${e.message}`); finish(1, null); });
  child.on("close", finish);
  jobs.set(id, job);
  // keep the 50 most recent jobs
  const ids = [...jobs.keys()];
  for (const old of ids.slice(0, Math.max(0, ids.length - 50))) if (jobs.get(old).status !== "running") jobs.delete(old);
  return job;
}
const publicJob = ({ child, listeners, lines, ...j }) => ({ ...j, lineCount: lines.length });

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
    // `agy models` prints "<id>\t<label>" lines
    list: async () => (await capture("agy", ["models"])).split("\n").map((l) => l.split("\t")).filter(([id, label]) => id && label && /^[\w.-]+$/.test(id)).map(([id, label]) => ({ id, label: label.trim() })),
  },
  codex: {
    bin: "codex",
    run: (prompt, model) => ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "-C", ROOT, ...(model ? ["-m", model] : []), prompt],
    // `codex debug models` prints the model catalog as JSON; keep the ones its picker lists
    list: async () => JSON.parse(await capture("codex", ["debug", "models"])).models.filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, label: m.display_name })),
  },
  claude: {
    bin: "claude",
    run: (prompt, model) => ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep", ...(model ? ["--model", model] : [])],
    // no listing command: the CLI's aliases always point at the latest model of each family
    list: async () => [
      { id: "opus", label: "Opus (latest)" },
      { id: "sonnet", label: "Sonnet (latest)" },
      { id: "haiku", label: "Haiku (latest)" },
      { id: "fable", label: "Fable (latest)" },
    ],
  },
};
const installed = (bin) => spawnSync("sh", ["-c", 'command -v "$1"', "sh", bin], { stdio: "ignore" }).status === 0;

/** stdout of a short command, or a rejection after 30 s */
function capture(bin, argv) {
  return new Promise((ok, fail) => {
    const child = spawn(bin, argv, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    const timer = setTimeout(() => { child.kill(); fail(new Error(`${bin} timed out`)); }, 30000);
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

/** a folder name from free text: "The Lost Shadow!" -> "the-lost-shadow" (empty for text with no Latin letters) */
function slugify(text, words = 8) {
  return String(text || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, words)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");
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

function storyPrompt({ name, title, lang, style, idea }) {
  const km = lang === "km";
  const look = styles().find((s) => s.id === style);
  return `You are writing a new film in this repository of 3D story films. The folder outputs/${name}/ was just scaffolded from core/template and still holds the template story and shots.

Film folder: outputs/${name}
Title: ${title || "none given: choose a short, catchy title that fits the story and set it as \"title\" in story.json"}
Language: ${km ? 'Khmer ("lang": "km")' : 'English ("lang": "en")'}
Style: ${look.label} ("style": "${look.id}", already set in story.json; keep it). ${look.description} Read the "Styles" section of AGENTS.md for its framing notes.
Idea: ${idea || (title ? "Invent an original story that fits the title." : "Invent an original story.")}

Steps:
1. Read AGENTS.md (rules, story.json fields, engine reference and lessons), analysis/ANALYSIS.md (the story template), the exports of core/engine/stage.js, and one finished film as a reference: outputs/dream-rain/story/story.json and outputs/dream-rain/film.js.
2. Write outputs/${name}/story/story.json: 2–3 minutes of first-person narration by Zero (${km ? "Khmer text sized to 2–3 minutes when spoken" : "about 350–520 English words"}). Rule hook in the first 4 s, a list of examples, "my name is Zero", the turn at 40–60 %, twists at 60–90 %, a cliffhanger or reversal at the end. Add "cuts" words so shots average 1.6–2.1 s, and use "big", "mood", "hits", "pops", "flash" and "sfx" where they help. ${title ? "Keep the title" : "Set the title you chose"}, set "names" (every name captions must keep capitalised) and "lang": "${km ? "km" : "en"}".
3. Write outputs/${name}/film.js: one staged shot for every cut id (each line id, "<id>.1", "<id>.2"… for its cuts, and "tail"). Every shot gets a camera move and uses only what core/stage.js exports. Film-only characters go in "cast", film-only helpers stay in film.js. Shots must be pure functions of t (no Math.random, no clocks).

Rules: change only files inside outputs/${name}/. Do not run narrate, voice, plan, audio, shots or render, and do not change core/, voices/ or other films. Never read .env.local. The story is original, and the family is fixed: Zero (narrator), Zeebra (elder brother), Luna (mother), Zip (father).

When you finish, print a short summary: number of lines, words and cuts, and the main characters.`;
}

function startAgent(film, agent, model, opts) {
  const a = AGENTS[agent];
  return startJob(film, { step: "write", agent, model }, a.bin, a.run(storyPrompt({ name: film, ...opts }), model));
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

function serveMedia(req, res, film, rel) {
  const dir = join(OUTPUTS, film);
  const clean = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!MEDIA_ROOTS.some((r) => clean.startsWith(r))) return send(res, 404, { error: "Not found" });
  const file = resolve(dir, clean);
  if (!file.startsWith(dir + sep) || !existsSync(file)) return send(res, 404, { error: "Not found" });
  const { size: total } = statSync(file);
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : total - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) { res.writeHead(416, { "content-range": `bytes */${total}` }); return res.end(); }
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${total}`, "accept-ranges": "bytes", "cache-control": "no-cache" });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": total, "accept-ranges": "bytes", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

/** Connect-style handler: answers /api/* and /media/*, calls next() for anything else. */
export async function handler(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p.startsWith("/media/")) {
      const [, , film, ...rest] = p.split("/");
      if (!NAME.test(film)) return send(res, 404, { error: "Not found" });
      return serveMedia(req, res, film, decodeURIComponent(rest.join("/")));
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

    if (p === "/api/films" && req.method === "POST") {
      const { name: rawName, title: rawTitle, lang = "en", style: rawStyle = null, agent = null, model = null, idea: rawIdea = "" } = await body(req);
      const idea = String(rawIdea || "").slice(0, 4000);
      const given = String(rawTitle || "").trim().slice(0, 200);
      // with an agent the folder name and title may be left empty: the name comes from the title or idea, the agent picks the title
      const name = rawName ? String(rawName) : agent ? autoName(given, idea) : "";
      if (!NAME.test(name || "")) return send(res, 400, { error: "Use lowercase letters, numbers and dashes for the name" });
      if (existsSync(join(OUTPUTS, name))) return send(res, 409, { error: `outputs/${name} already exists` });
      if (!["en", "km"].includes(lang)) return send(res, 400, { error: "lang must be en or km" });
      const style = rawStyle == null ? styleOf() : styles().find((x) => x.id === rawStyle)?.id;
      if (!style) return send(res, 400, { error: `Unknown style: ${rawStyle}` });
      if (agent) {
        const a = (await agents()).find((x) => x.name === agent);
        if (!a) return send(res, 400, { error: `Agent ${agent} is not allowed (STUDIO_AGENTS)` });
        if (!a.installed) return send(res, 400, { error: `${agent} is not installed on this machine` });
        if (model && !a.models.some((m) => m.id === model)) return send(res, 400, { error: `Model ${model} is not offered for ${agent}` });
      }
      const title = given || name;
      const r = spawnSync(process.execPath, [FILM_CLI, "new", name, title], { cwd: ROOT, encoding: "utf8" });
      if (r.status !== 0) return send(res, 500, { error: (r.stderr || r.stdout).trim() });
      // new films use the /my-editor voice clone, picked by "lang"
      const storyPath = join(OUTPUTS, name, "story/story.json");
      const story = readJson(storyPath);
      writeFileSync(storyPath, JSON.stringify({ ...story, lang, style }, null, 2) + "\n");
      const job = agent ? publicJob(startAgent(name, agent, model || null, { title: given || null, lang, style, idea })) : null;
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
