// Narration: ElevenLabs text-to-speech with character timestamps.
// Writes assets/audio/vo.mp3 and story/timing.js (word and line timings).
// Run from the project root:  node --env-file=.env.local pilot/scripts/tts.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { elevenlabs, DEFAULT_VOICE_ID } from "../../elevenlabs.js";

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const story = JSON.parse(readFileSync(p("../story/story.json"), "utf8"));
const text = story.lines.map((l) => l.text).join(" ");
const hash = createHash("sha1")
  .update(JSON.stringify([text, story.voice, DEFAULT_VOICE_ID]))
  .digest("hex");

const audioPath = p("../assets/audio/vo.mp3");
const rawPath = p("../story/alignment.json");
let raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, "utf8")) : null;

if (!raw || raw.hash !== hash || !existsSync(audioPath)) {
  console.log(`Requesting speech: ${text.length} characters, voice ${DEFAULT_VOICE_ID}`);
  const res = await elevenlabs.textToSpeech.convertWithTimestamps(DEFAULT_VOICE_ID, {
    text,
    modelId: story.voice.model,
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: story.voice.stability,
      similarityBoost: story.voice.similarity,
      style: story.voice.style,
      speed: story.voice.speed,
      useSpeakerBoost: true,
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
  if (/\s/.test(ch)) {
    cur = null;
    return;
  }
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
const duration = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath])
    .toString()
    .trim(),
);
const timing = {
  duration: r(duration),
  lines,
  words: words.map((w) => ({ w: w.w, s: r(w.s), e: r(w.e), line: w.line })),
};
writeFileSync(p("../story/timing.js"), `window.STORY_TIMING = ${JSON.stringify(timing, null, 1)};\n`);
console.log(`VO ${duration.toFixed(2)} s, ${words.length} words, ${(words.length / duration * 60).toFixed(0)} wpm`);
for (const l of lines) console.log(l.id.padEnd(8), l.start.toFixed(2), l.end.toFixed(2));
