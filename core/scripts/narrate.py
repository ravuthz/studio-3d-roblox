#!/usr/bin/env python3
"""Narration with the /my-editor VoxCPM2 voice clone, plus word timings.

One TTS chunk per story line, cloned from the project voice for the film's language
(story.json "lang": "en" -> voices/in-town.mp3, "km" -> voices/ravuthz.mp3).
Chunks are cached in outputs/<film>/.cache/vo/ and only regenerated when a line changes.
Word timings come from local faster-whisper (English) aligned to the script words; words it
misses, and every Khmer word, are spread over the gap by character length.

Writes outputs/<film>/assets/audio/vo.mp3 and outputs/<film>/story/timing.js
(same format core/scripts/tts.mjs wrote).

  python3 core/scripts/narrate.py <film> [--redo id,id] [--jobs 3]
"""
import argparse, difflib, hashlib, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SKILL = Path(os.environ.get("MY_EDITOR", ROOT / ".agents/skills/my-editor"))  # project copy of /my-editor (shared by all agents)
TTS = SKILL / "scripts/tts.py"
VOICES = {"en": ROOT / "voices/in-town.mp3", "km": ROOT / "voices/ravuthz.mp3"}
SR = 44100
GAP, SECTION_GAP, HEAD = 0.30, 0.55, 0.10  # seconds of silence between lines / before a mood change / at start


def bare(w):
    return re.sub(r"[^a-z0-9ក-៿]", "", w.lower())


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def synth(text, ref, out, lang):
    cmd = [sys.executable, str(TTS), "--text", text, "--ref", str(ref), "--out", str(out)]
    if lang != "km":
        cmd.append("--no-numbers")  # the number speller writes Khmer words
    r = subprocess.run(cmd, capture_output=True, text=True)
    svc = re.findall(r"service: (.+)", r.stderr)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError(f"TTS failed for {out.name}:\n{r.stderr[-1500:]}")
    return svc[-1] if svc else "?"


_model = None


def whisper_words(path, prompt):
    global _model
    from faster_whisper import WhisperModel
    if _model is None:
        _model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segs, _ = _model.transcribe(str(path), language="en", word_timestamps=True, initial_prompt=prompt,
                                vad_filter=False, beam_size=5)
    return [(w.word.strip(), w.start, w.end) for s in segs for w in s.words]


def align(words, heard, dur):
    """Times for each script word: matched whisper words keep theirs, the rest are interpolated."""
    t = [None] * len(words)
    a, b = [bare(w) for w in words], [bare(h[0]) for h in heard]
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            t[blk.a + k] = [heard[blk.b + k][1], heard[blk.b + k][2]]
    i = 0
    while i < len(words):
        if t[i] is not None:
            i += 1
            continue
        j = i
        while j < len(words) and t[j] is None:
            j += 1
        lo = t[i - 1][1] if i > 0 else 0.0
        hi = t[j][0] if j < len(words) else dur
        if hi - lo < 0.05 * (j - i):  # no room: borrow from the neighbours
            lo = t[i - 1][0] if i > 0 else 0.0
            hi = t[j][1] if j < len(words) else dur
        weights = [max(1, len(bare(w))) for w in words[i:j]]
        acc, tot = lo, sum(weights)
        for k, wgt in enumerate(weights):
            step = (hi - lo) * wgt / tot
            t[i + k] = [acc, acc + step]
            acc += step
        i = j
    for k in range(len(t)):  # monotonic, inside the chunk
        s = max(0.0, t[k][0], t[k - 1][0] + 0.02 if k else 0.0)
        t[k] = [min(s, dur - 0.02), min(max(t[k][1], s + 0.04), dur)]
    return t, difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film")
    ap.add_argument("--redo", default="", help="comma-separated line ids to regenerate")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()

    film = Path(a.film) if "/" in a.film else ROOT / "outputs" / a.film
    story = json.loads((film / "story/story.json").read_text())
    lang = story.get("lang", "en")
    ref = VOICES[lang]
    lines = story["lines"]
    cache = film / ".cache/vo"
    cache.mkdir(parents=True, exist_ok=True)
    redo = set(filter(None, a.redo.split(",")))

    def chunk_path(line):
        key = hashlib.sha1(json.dumps([line["text"], str(ref.name), lang, 2]).encode()).hexdigest()[:10]
        return cache / f"{line['id']}-{key}.wav"

    todo = [l for l in lines if l["id"] in redo or not chunk_path(l).exists()]
    for l in todo:
        chunk_path(l).unlink(missing_ok=True)
    services = {}
    if todo:
        print(f"Synthesising {len(todo)} of {len(lines)} lines with {ref.name} ({lang})", flush=True)

        def job(l):
            svc = synth(l["text"], ref, chunk_path(l), lang)
            print(f"  {l['id']:<10} {svc}", flush=True)
            return l["id"], svc
        with ThreadPoolExecutor(a.jobs) as ex:
            services = dict(ex.map(job, todo))
    else:
        print("Narration unchanged; reusing cached chunks.")

    # join with silences
    parts, offsets, t = [np.zeros(int(HEAD * SR), np.float32)], [], HEAD
    clips = []
    for i, l in enumerate(lines):
        if i:
            g = SECTION_GAP if l.get("mood") else GAP
            parts.append(np.zeros(int(g * SR), np.float32))
            t += g
        x = decode(chunk_path(l))
        clips.append(x)
        offsets.append(t)
        parts.append(x)
        t += len(x) / SR
    voice = np.concatenate(parts)
    raw = cache / "voice_raw.f32"
    voice.astype(np.float32).tofile(raw)
    (film / "assets/audio").mkdir(parents=True, exist_ok=True)
    out = film / "assets/audio/vo.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(raw),
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "128k",
                    str(out)], check=True)
    raw.unlink()

    # word timings
    r3 = lambda v: round(v, 3)
    words_out, lines_out, weak = [], [], []
    for i, l in enumerate(lines):
        words = l["text"].split()
        dur = len(clips[i]) / SR
        if lang == "en":
            heard = whisper_words(chunk_path(l), l["text"])
            times, ratio = align(words, heard, dur)
            if ratio < 0.8:
                weak.append(f"{l['id']} ({ratio:.2f}: heard \"{' '.join(h[0] for h in heard)}\")")
        else:
            times, _ = align(words, [], dur)
        ws = [{"w": w, "s": r3(offsets[i] + s), "e": r3(offsets[i] + e), "line": i} for w, (s, e) in zip(words, times)]
        words_out += ws
        lines_out.append({"id": l["id"], "start": ws[0]["s"], "end": ws[-1]["e"], "big": l.get("big", [])})
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                               capture_output=True, text=True).stdout)
    timing = {"duration": r3(dur), "lines": lines_out, "words": words_out}
    (film / "story/timing.js").write_text(f"window.STORY_TIMING = {json.dumps(timing, indent=1)};\n")
    used = sorted(set(services.values()))
    print(f"VO {dur:.2f} s ({dur / 60:.2f} min), {len(words_out)} words, {len(words_out) / dur * 60:.0f} wpm"
          + (f"; services: {', '.join(used)}" if used else ""))
    if weak:
        print("Lines that may be misread (regenerate with --redo):\n  " + "\n  ".join(weak), flush=True)


if __name__ == "__main__":
    main()
