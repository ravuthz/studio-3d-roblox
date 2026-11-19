#!/usr/bin/env node
// Autopilot from the terminal: next topic -> new film -> agent writes story.json and film.js -> build -> MP4,
// with no confirmation at any step. Same pipeline as POST /api/auto in the studio.
//
//   npm run auto                                   one film, first installed agent, English
//   npm run auto -- --count 3 --agent claude --model opus
//   npm run auto -- --count 0                      keep making films until Ctrl+C
//   npm run auto -- --lang km --builtin-topics     Khmer narration, topics from the built-in list
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
  console.log("npm run auto -- [--count N (0 = until stopped)] [--agent agy|codex|claude] [--model id] [--lang en|km] [--builtin-topics]");
  process.exit(0);
}

autoHooks.add((line) => console.log(`\n[auto] ${line}`));
jobHooks.add((job) => {
  console.log(`[auto] ── ${job.step === "write" ? `${job.agent} writes ${job.film}` : `film ${job.step} ${job.film}`}`);
  job.listeners.add((ev) => { if (ev.type === "line") console.log(`  ${ev.line}`); });
});

let stops = 0;
process.on("SIGINT", () => {
  if (++stops > 1) process.exit(130);
  console.log("\n[auto] stopping after the current step is killed (Ctrl+C again to quit now)");
  stopAuto();
});

try {
  const state = await startAuto({
    agent: opt("--agent"),
    model: opt("--model"),
    lang: opt("--lang", "en"),
    count: Number(opt("--count", "1")),
    topicAgent: !args.includes("--builtin-topics"),
  });
  console.log(`[auto] ${state.agent}${state.model ? ` (${state.model})` : ""} · ${state.lang} · ${state.count || "∞"} film(s)`);
  await autoDone();
  const { autoState } = await import("./api.mjs");
  const films = autoState()?.films ?? [];
  for (const f of films) console.log(`[auto] ${f.status === "done" ? "✓" : "✗"} ${f.name}  ${f.render || f.status}`);
  process.exit(films.length && films.every((f) => f.status === "done") ? 0 : 1);
} catch (e) {
  console.error(`[auto] ${e.message}`);
  process.exit(1);
}
