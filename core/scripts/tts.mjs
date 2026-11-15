// Narration: ElevenLabs text-to-speech with character timestamps.
// Writes <film>/assets/audio/vo.mp3 and <film>/story/timing.js (word and line timings).
// The request is cached: it only spends credits when the text or voice settings change.
// Run from the project root:  node --env-file=.env.local core/scripts/tts.mjs <film>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { elevenlabs, DEFAULT_VOICE_ID } from "../../elevenlabs.js";
import { filmDir } from "./lib.mjs";

const dir = filmDir(process.argv[2]);
const story = JSON.parse(readFileSync(join(dir, "story/story.json"), "utf8"));
const voice = { model: "eleven_multilingual_v2", speed: 1.0, stability: 0.4, similarity: 0.8, style: 0.35, ...story.voice };
const voiceId = story.voiceId || DEFAULT_VOICE_ID;
const text = story.lines.map((l) => l.text).join(" ");
const hash = createHash("sha1").update(JSON.stringify([text, story.voice, voiceId])).digest("hex");

mkdirSync(join(dir, "assets/audio"), { recursive: true });
const audioPath = join(dir, "assets/audio/vo.mp3");
const rawPath = join(dir, "story/alignment.json");
let raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, "utf8")) : null;

if (!raw || raw.hash !== hash || !existsSync(audioPath)) {
  console.log(`Requesting speech: ${text.length} characters, voice ${voiceId}`);
  const res = await elevenlabs.textToSpeech.convertWithTimestamps(voiceId, {
    text,
    modelId: voice.model,
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: voice.stability, similarityBoost: voice.similarity, style: voice.style,
      speed: voice.speed, useSpeakerBoost: true,
    },
  });
  writeFileSync(audioPath, Buffer.from(res.audioBase64, "base64"));
  raw = { hash, alignment: res.alignment };
  writeFileSync(rawPath, JSON.stringify(raw));
} else {
  console.log("Narration unchanged; reusing cached audio.");
}

// characters -> words, each tagged with its line
const { characters, characterStartTimesSeconds: cs, characterEndTimesSeconds: ce } = raw.alignment;
const lineOfChar = [];
story.lines.forEach((l, i) => {
  for (let k = 0; k < l.text.length; k++) lineOfChar.push(i);
  lineOfChar.push(i); // joining space
});
const words = [];
let cur = null;
characters.forEach((ch, i) => {
  if (/\s/.test(ch)) { cur = null; return; }
  if (!cur) {
    cur = { w: "", s: cs[i], e: ce[i], line: lineOfChar[Math.min(i, lineOfChar.length - 1)] };
    words.push(cur);
  }
  cur.w += ch;
  cur.e = ce[i];
});
const r = (x) => Math.round(x * 1000) / 1000;
const lines = story.lines.map((l, i) => {
  const ws = words.filter((w) => w.line === i);
  return { id: l.id, start: r(ws[0].s), end: r(ws[ws.length - 1].e), big: l.big || [] };
});
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath]).toString().trim());
const timing = { duration: r(duration), lines, words: words.map((w) => ({ w: w.w, s: r(w.s), e: r(w.e), line: w.line })) };
writeFileSync(join(dir, "story/timing.js"), `window.STORY_TIMING = ${JSON.stringify(timing, null, 1)};\n`);
console.log(`VO ${duration.toFixed(2)} s, ${words.length} words, ${((words.length / duration) * 60).toFixed(0)} wpm`);
