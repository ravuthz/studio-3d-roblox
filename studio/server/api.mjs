// Film Studio API: reads outputs/<film>/ and runs core/scripts/film.mjs steps as jobs.
// Used as Vite middleware in dev (vite.config.ts) and by server/serve.mjs in production.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function startJob(film, step, args = []) {
  if ([...jobs.values()].some((j) => j.film === film && j.status === "running")) {
    throw Object.assign(new Error(`A job is already running for ${film}`), { status: 409 });
  }
  const id = `${Date.now().toString(36)}-${++seq}`;
  const child = spawn(process.execPath, [FILM_CLI, step, film, ...args], { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });
  const job = { id, film, step, args, status: "running", code: null, startedAt: Date.now(), endedAt: null, lines: [], child, listeners: new Set() };
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
  child.on("close", (code, signal) => {
    if (partial) push(partial);
    job.code = code;
    job.status = signal ? "stopped" : code === 0 ? "done" : "failed";
    job.endedAt = Date.now();
    job.child = null;
    for (const fn of job.listeners) fn({ type: "end", job: publicJob(job) });
    job.listeners.clear();
  });
  jobs.set(id, job);
  // keep the 50 most recent jobs
  const ids = [...jobs.keys()];
  for (const old of ids.slice(0, Math.max(0, ids.length - 50))) if (jobs.get(old).status !== "running") jobs.delete(old);
  return job;
}
const publicJob = ({ child, listeners, lines, ...j }) => ({ ...j, lineCount: lines.length });

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

    if (p === "/api/films" && req.method === "POST") {
      const { name, title } = await body(req);
      if (!NAME.test(name || "")) return send(res, 400, { error: "Use lowercase letters, numbers and dashes for the name" });
      if (existsSync(join(OUTPUTS, name))) return send(res, 409, { error: `outputs/${name} already exists` });
      const r = spawnSync(process.execPath, [FILM_CLI, "new", name, String(title || name).slice(0, 200)], { cwd: ROOT, encoding: "utf8" });
      if (r.status !== 0) return send(res, 500, { error: (r.stderr || r.stdout).trim() });
      return send(res, 201, summary(name));
    }

    let m = p.match(/^\/api\/films\/([^/]+)$/);
    if (m && req.method === "GET") {
      if (!filmNames().includes(m[1])) return send(res, 404, { error: "No such film" });
      return send(res, 200, summary(m[1], { full: true }));
    }

    m = p.match(/^\/api\/films\/([^/]+)\/run$/);
    if (m && req.method === "POST") {
      const film = m[1];
      if (!filmNames().includes(film)) return send(res, 404, { error: "No such film" });
      const { step, args = [] } = await body(req);
      if (!STEPS.has(step)) return send(res, 400, { error: `Unknown step: ${step}` });
      if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || !CUT_ID.test(a))) return send(res, 400, { error: "Bad arguments" });
      return send(res, 202, publicJob(startJob(film, step, args)));
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
