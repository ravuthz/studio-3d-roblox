#!/usr/bin/env node
// Autopilot from the terminal: next topic -> new film -> agent writes story.json and film.js -> build -> MP4,
// with no confirmation at any step. Same pipeline as POST /api/auto in the studio.
//
//   npm run auto                                   one film, first installed agent, English, default series
//   npm run auto -- --series lover --count 3 --agent claude --model opus
//   npm run auto -- --count 0                      keep making films until Ctrl+C
//   npm run auto -- --count 10 --parallel 4        four agents write at once; builds still run one at a time
//   npm run auto -- --series family --lang km --builtin-topics
//   npm run auto -- --style pixar-disney           the film style (default: roblox; see `npm run film styles`)
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// STUDIO_* settings from studio/.env (the shell environment wins), as the dev server does
const env = join(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const { autoDone, autoHooks, jobHooks, startAuto, stopAuto } = await import("./api.mjs");

const args = process.argv.slice(2);
const opt = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
if (args.includes("--help") || args.includes("-h")) {
  console.log("npm run auto -- [--series family|lover] [--style roblox|pixar-disney] [--count N (0 = until stopped)] [--agent agy|codex|claude] [--model id] [--lang en|km] [--parallel N (agents writing at once, default 3)] [--builtin-topics]");
  process.exit(0);
}

autoHooks.add((line) => console.log(`\n[auto] ${line}`));
jobHooks.add((job) => {
  console.log(`[auto] ── ${job.step === "write" ? `${job.agent} writes ${job.film}` : `film ${job.step} ${job.film}`}`);
  job.listeners.add((ev) => { if (ev.type === "line") console.log(`  ${job.film} │ ${ev.line}`); });
});

let stops = 0;
process.on("SIGINT", () => {
  if (++stops > 1) process.exit(130);
  console.log("\n[auto] stopping after the current step is killed (Ctrl+C again to quit now)");
  stopAuto();
});

try {
  const state = await startAuto({
    series: opt("--series"),
    style: opt("--style"),
    agent: opt("--agent"),
    model: opt("--model"),
    lang: opt("--lang", "en"),
    count: Number(opt("--count", "1")),
    parallel: Number(opt("--parallel", "3")),
    topicAgent: !args.includes("--builtin-topics"),
  });
  console.log(`[auto] ${state.series} · ${state.agent}${state.model ? ` (${state.model})` : ""} · ${state.lang} · ${state.count || "∞"} film(s) · ${state.parallel} writing at once`);
  await autoDone();
  const { autoState } = await import("./api.mjs");
  const films = autoState()?.films ?? [];
  for (const f of films) console.log(`[auto] ${f.status === "done" ? "✓" : "✗"} ${f.name}  ${f.render || f.status}`);
  process.exit(films.length && films.every((f) => f.status === "done") ? 0 : 1);
} catch (e) {
  console.error(`[auto] ${e.message}`);
  process.exit(1);
}
