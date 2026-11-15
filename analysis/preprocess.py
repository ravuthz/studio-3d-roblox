"""Preprocess reference videos: audio, transcript (word timestamps), scene cuts,
1 fps frames, timestamped contact sheets, loudness. Output: analysis/vNN/."""
import glob, json, os, re, subprocess, sys

SRC = "/Users/ravuthz/Projects/@data/3d-robox-shorts"
OUT = os.path.dirname(os.path.abspath(__file__))


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def main():
    from faster_whisper import WhisperModel

    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    videos = sorted(glob.glob(os.path.join(SRC, "*.mp4")))
    index = []
    for i, v in enumerate(videos, 1):
        vid = f"v{i:02d}"
        d = os.path.join(OUT, vid)
        os.makedirs(os.path.join(d, "frames"), exist_ok=True)
        os.makedirs(os.path.join(d, "sheets"), exist_ok=True)
        title = re.sub(r"^@zaylento\.yt-[\d_-]+-", "", os.path.basename(v))
        title = re.sub(r"-\d+\.mp4$", "", title).replace("-", " ")
        dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                         "-of", "csv=p=0", v]).stdout.strip())
        # audio
        wav = os.path.join(d, "audio.wav")
        run(["ffmpeg", "-y", "-i", v, "-ac", "1", "-ar", "16000", wav])
        # loudness
        lo = run(["ffmpeg", "-i", v, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
        summary = lo[lo.rfind("Summary:"):] if "Summary:" in lo else ""
        # scene cuts
        sc = run(["ffmpeg", "-i", v, "-vf", "select='gt(scene,0.30)',showinfo", "-an",
                  "-f", "null", "-"]).stderr
        cuts = [round(float(x), 2) for x in re.findall(r"pts_time:([\d.]+)", sc)]
        # frames at 1 fps, 360 wide
        run(["ffmpeg", "-y", "-i", v, "-vf", "fps=1,scale=360:-2", "-q:v", "4",
             os.path.join(d, "frames", "f_%04d.jpg")])
        # contact sheets: 2 fps, timestamp burned, 5x4 tiles (10 s per sheet)
        run(["ffmpeg", "-y", "-i", v, "-vf",
             "fps=2,scale=216:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=16:"
             "fontcolor=yellow:box=1:boxcolor=black@0.7,tile=5x4",
             "-q:v", "3", os.path.join(d, "sheets", "s_%03d.jpg")])
        # transcript
        segs, _ = model.transcribe(wav, word_timestamps=True, vad_filter=False)
        segments, words = [], []
        for s in segs:
            segments.append({"start": round(s.start, 2), "end": round(s.end, 2),
                             "text": s.text.strip()})
            for w in s.words or []:
                words.append({"w": w.word.strip(), "s": round(w.start, 2),
                              "e": round(w.end, 2)})
        with open(os.path.join(d, "transcript.txt"), "w") as f:
            for s in segments:
                f.write(f"[{s['start']:7.2f} - {s['end']:7.2f}] {s['text']}\n")
        nwords = len(words)
        meta = {"id": vid, "title": title, "file": v, "duration": dur, "cuts": cuts,
                "n_cuts": len(cuts), "avg_shot_s": round(dur / (len(cuts) + 1), 2),
                "n_words": nwords, "wpm": round(nwords / dur * 60, 1),
                "loudness_summary": summary.strip()}
        json.dump({"segments": segments, "words": words},
                  open(os.path.join(d, "transcript.json"), "w"))
        json.dump(meta, open(os.path.join(d, "meta.json"), "w"), indent=1)
        index.append({k: meta[k] for k in ("id", "title", "duration", "n_cuts",
                                           "avg_shot_s", "n_words", "wpm")})
        print(vid, title, dur, len(cuts), nwords, flush=True)
    json.dump(index, open(os.path.join(OUT, "index.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
