---
name: my-editor
description: Edit video/audio with ffmpeg, generate voice-over with VoxCPM2 TTS (voice design or voice cloning from ./voices/) with fallback across three Gradio services, synthesize sound effects with Python (whoosh, click, pop, ding, riser, impact, etc.), and transcribe speech to SRT/JSON subtitles with Gemini (Khmer by default, any language supported). Use when the user runs /my-editor or asks for narration, dubbing, voice-over, sound effects, transcription, subtitles/captions (including Khmer), or mixing audio into a video.
---

# /my-editor

Generate speech with VoxCPM2 (Gradio services, with fallback), create sound effects with Python (`sfx.py`, next to this file), transcribe speech (Khmer and other languages) with Gemini (`scripts/transcribe.py`), and edit/assemble media with ffmpeg.

## 0. Requirements check (run once per session, only for what the task needs)

```bash
which ffmpeg ffprobe >/dev/null || echo "ffmpeg missing: install it (apt-get install -y ffmpeg) or tell the user"
```

- Check before installing; skip anything already present. Do not re-run installs on every call.
- Python packages: `gradio_client` for TTS, `numpy` + `scipy` for sound effects, `google-genai` + `python-dotenv` for transcription. Install only the ones the current task uses.
- If an install fails (no network, blocked), tell the user which package failed instead of skipping the step.

## 1. TTS services (try in order, fall back on failure)

| #   | Service                     | URL                                               |
| --- | --------------------------- | ------------------------------------------------- |
| 1   | HuggingFace Space (openbmb) | https://huggingface.co/spaces/openbmb/VoxCPM-Demo |
| 2   | appkh VoxCPM2               | https://gradio-voxcpm2.appkh.online/              |
| 3   | appkh VoxCPM                | https://gradio-voxcmp.appkh.online/               |

Fallback rules:

- Try service 1. If it errors, times out (> 120 s), is queued/sleeping, or returns empty/silent audio, move to 2, then 3.
- Tell the user which service was used (and which failed and why).
- If all three fail, stop and report the errors. Do not invent audio.
- Never hard-code endpoint names or parameters. Each Space may differ, so inspect first:

```python
from gradio_client import Client
c = Client(URL)          # use "openbmb/VoxCPM-Demo" for service 1
c.view_api()             # read endpoint names + parameters, then call c.predict(..., api_name=...)
```

Install only if missing (check first, never reinstall blindly):

```bash
python -c "import gradio_client" 2>/dev/null || pip install -q gradio_client --break-system-packages
```

## 2. Voice modes

Ask the user (only if unclear) which mode they want:

- **Voice cloning (default if the voices folder has files):** use the user's own voice from the voices folder: `$MY_EDITOR_VOICES` when that variable is set (Docker deployment: `/data/voices`, read-only), else `./voices/`. Below, `./voices/` means that folder.
  - List `./voices/` (wav/mp3/m4a/flac). If several, ask which one, or match by name.
  - Convert the reference to clean mono wav first:
    `ffmpeg -y -i ./voices/<file> -ac 1 -ar 16000 -t 20 -af "highpass=f=70,afftdn=nr=12:nf=-45,loudnorm=I=-20:TP=-2:LRA=7" /tmp/ref.wav` (the `loudnorm` levels the reference and removes clipping; clone output follows the reference's level and dynamics, so an uneven or clipped reference gives uneven chunks)
  - If the service asks for reference transcript text, use the transcript if provided (e.g. `./voices/<file>.txt`), else ask the user.
  - Upload the ref wav through the service's reference-audio parameter.
- **Voice design:** no reference audio. Pass a natural-language voice description (e.g. "warm young female, calm, medium pace") into the service's voice/control-instruction field.

Keep the same voice settings for every chunk of one project so the voice stays consistent.

## 2b. One-command TTS: `scripts/tts.py`

Does the service fallback (section 1), number spelling, noise cleanup, edge trim, optional slow-down and loudnorm in one call:

```bash
python scripts/tts.py --text-file script.txt --out output/voice.wav \
  --design "adult man, deep low-pitched male voice, calm explainer" --gender male --slow 0.8
python scripts/tts.py --text "..." --out output/voice.wav --ref voices/male-1.wav --prompt-text "reference transcript"
```

`--gender male|female` measures the median pitch and regenerates (up to `--tries`, default 4) until it matches (male < 150 Hz, female > 185 Hz). Service settings are `use_prompt_text=False` (True only when `--prompt-text` is given), `cfg_value_input=2.0`, `do_normalize=True`, `denoise=True`; `--cfg`, `--no-normalize` and `--no-denoise` override them. `--slow 0.8` slows by 25% without changing pitch; the model ignores "slow pace" in the description, so use this. Voice design is random per call: generate a whole script in one call (or clone a reference) so the voice stays the same.

## 3. Generation workflow

1. Get the script text. Split into chunks of about 1-3 sentences (keeps quality and makes retries cheap).
2. **Spell out numbers for the TTS only.** Run every chunk through `scripts/khmer_numbers.py` before sending it to the TTS, and keep the original text for subtitles/captions. Numbers (Latin `0-9` or Khmer `០-៩`) become Khmer words, with `$`, `៛`, `រៀល`, `USD`, `KHR` and `%` read as units:

   | Original | Sent to TTS |
   | --- | --- |
   | `1,000$` | `មួយពាន់ដុល្លា` |
   | `១០០០​៛` | `មួយពាន់រៀល` |
   | `$1.50` | `មួយដុល្លាហាសិបសេន` |
   | `25%` | `ម្ភៃប្រាំភាគរយ` |
   | `3.5` | `បីក្បៀសប្រាំ` |
   | `ឆ្នាំ២០២៤` | `ឆ្នាំពីរពាន់ម្ភៃបួន` |

   ```bash
   python scripts/khmer_numbers.py "តម្លៃ 1,000$"        # prints the spoken text
   python scripts/khmer_numbers.py --file chunk.txt      # or "-" for stdin
   ```
   ```python
   import sys; sys.path.insert(0, "scripts")
   from khmer_numbers import speak_numbers
   tts_text = speak_numbers(chunk)   # send this to the TTS; use `chunk` for the subtitle line
   ```
   Numbers with a leading zero (phone numbers) are split into groups of 3 digits from the left, each read as a number: `012345678` is `សូន្យដប់ពីរ បីរយសែសិបប្រាំ ប្រាំមួយរយចិតសិបប្រាំបី`. Digits glued to Latin letters keep the English word and read the number in English: `mp4` is `mp four`, `covid19` is `covid nineteen`. Ordinals read with ទី: `1st` is `ទីមួយ`, `2nd` is `ទីពីរ`. Ranges read with ទៅ: `10-20` is `ដប់ទៅម្ភៃ`, `3-4` is `បីទៅបួន`. 10,000 is `មួយម៉ឺន` and 100,000 is `មួយសែន`. Do not run this on text that goes to subtitles or `transcribe.py` output.
3. For each chunk, call the TTS (with fallback) with the converted text and save to `./output/tts/NNN.wav`.
4. Verify each file is non-empty: `ffprobe -v error -show_entries format=duration -of csv=p=0 file.wav` (duration > 0.3 s).
5. Normalize and join:

```bash
# 5a. Per chunk: clean noise (rumble/hiss/TTS artifacts) BEFORE gain, trim edge silence, measure loudness, apply ONE fixed gain.
#     (Per-chunk single-pass loudnorm goes dynamic on short chunks and leaves some quiet.)
TARGET=-18   # LUFS per chunk; the final pass below sets the master level
for f in output/tts/[0-9][0-9][0-9].wav; do
  t="${f%.wav}_t.wav"
  ffmpeg -v error -y -i "$f" -af "highpass=f=70,lowpass=f=12000,afftdn=nr=12:nf=-45:tn=1,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,areverse,agate=threshold=0.01:ratio=2:attack=5:release=120" -ar 44100 -ac 1 "$t"
  I=$(ffmpeg -nostats -i "$t" -af ebur128 -f null - 2>&1 | awk '/Integrated loudness/{getline; print $2}' | tail -1)
  G=$(python3 -c "print(max(-30,min(30,$TARGET-float('${I:--40}'))))")
  ffmpeg -v error -y -i "$t" -af "volume=${G}dB,alimiter=limit=0.89:level=false" "${f%.wav}_n.wav"
done
# 5b. Concat, then ONE loudnorm over the whole voice track
for f in output/tts/*_n.wav; do echo "file '$PWD/$f'"; done > output/list.txt
ffmpeg -y -f concat -safe 0 -i output/list.txt -c copy output/voice_raw.wav
ffmpeg -y -i output/voice_raw.wav -af loudnorm=I=-16:TP=-1.5:LRA=7 -ar 44100 -ac 1 output/voice.wav
# 5c. Verify: each *_n.wav should read within ~1 LU of $TARGET
for f in output/tts/*_n.wav; do echo -n "$f "; ffmpeg -nostats -i "$f" -af ebur128 -f null - 2>&1 | awk '/Integrated loudness/{getline; print $2}' | tail -1; done
```

Edge trimming uses start-trim plus `areverse` on purpose: `silenceremove` with `stop_periods=1` cuts everything after the first internal pause, truncating chunks to ~3 s. Noise: the cleanup runs before the gain on purpose, since gain and the final `loudnorm` amplify hiss. If voice sounds watery or muffled, lower `afftdn nr` (12 to 8); if hiss remains, raise it (to 18) or lower `nf` (to -40). Keep the reference clean too, because a noisy reference makes the clone reproduce the noise.

A chunk that stays more than 3 LU off after 5a was clamped, which means it is near-silent or broken. Regenerate it. If clone chunks still sound uneven, the cause is the model, not the mix: use one clean 10-20 s reference for every chunk and identical settings.

Optional pause between chunks: generate with `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 pause.wav` and interleave in list.txt.

## 4. ffmpeg editing recipes

```bash
# Replace video audio with the voice-over
ffmpeg -y -i in.mp4 -i output/voice.wav -map 0:v -map 1:a -c:v copy -c:a aac -shortest output/final.mp4

# Mix voice over original audio (duck original to 25%)
ffmpeg -y -i in.mp4 -i output/voice.wav -filter_complex "[0:a]volume=0.25[a0];[a0][1:a]amix=inputs=2:duration=longest[a]" -map 0:v -map "[a]" -c:v copy -c:a aac output/final.mp4

# Add background music under voice (music at 15%)
ffmpeg -y -i output/voice.wav -i music.mp3 -filter_complex "[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first[a]" -map "[a]" output/mix.wav

# Cut / trim
ffmpeg -y -ss 00:00:05 -to 00:00:20 -i in.mp4 -c copy output/clip.mp4

# Concatenate clips (same codec)
ffmpeg -y -f concat -safe 0 -i clips.txt -c copy output/joined.mp4

# Burn subtitles
ffmpeg -y -i in.mp4 -vf "subtitles=subs.srt" -c:a copy output/subbed.mp4

# Speed adjust audio without pitch change (1.1x)
ffmpeg -y -i in.wav -filter:a "atempo=1.1" output/fast.wav

# Image + voice to video
ffmpeg -y -loop 1 -i cover.jpg -i output/voice.wav -c:v libx264 -tune stillimage -c:a aac -pix_fmt yuv420p -shortest output/video.mp4
```

Use `-c:v libx264 -preset veryfast -crf 23` when re-encoding unless the user wants best quality.

## 5. Sound effects (Python)

Use `sfx.py` (same folder as this SKILL.md; copy it to the working dir if needed). It synthesizes effects with NumPy/SciPy, with no external service.

```bash
python -c "import numpy, scipy" 2>/dev/null || pip install -q numpy scipy --break-system-packages   # only installs if missing
python sfx.py list                          # whoosh swoosh transition click pop beep ding laser riser impact rain typing
python sfx.py whoosh output/sfx/whoosh.wav --dur 0.6 --vol 0.8
python sfx.py all output/sfx                   # render every preset
```

- Pick the effect by purpose: scene cut -> `whoosh`/`transition`; button/UI -> `click`/`pop`; notification/success -> `ding`; build-up -> `riser` then `impact` on the beat; ambience -> `rain`; keyboard -> `typing`.
- If the user wants something not in the presets (e.g. explosion, glitch, footsteps), add a new function to `sfx.py` and register it in `PRESETS`: build waveforms with NumPy (sine/noise), shape with an envelope (`np.exp(-k*t)`), sweep pitch via `np.cumsum(freq)`, filter with `_filter`, then `_norm`. For realistic sounds (footsteps, crowds, animals) synthesis is limited; tell the user and suggest a sound-effect model/API or a sample library.
- Keep effects quieter than the voice: use `--vol 0.3-0.6` or `volume=` in ffmpeg.

Place an effect at a timestamp and mix it with the voice/video audio (delay in ms):

```bash
# whoosh at 3.5 s, ding at 8 s, over existing audio
ffmpeg -y -i in.mp4 -i output/sfx/whoosh.wav -i output/sfx/ding.wav \
  -filter_complex "[1:a]adelay=3500|3500,volume=0.6[s1];[2:a]adelay=8000|8000,volume=0.5[s2];[0:a][s1][s2]amix=inputs=3:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac output/final.mp4
```

Add `normalize=0` so amix does not lower the voice level. Check results with `ffprobe` and, if loudness matters, run `loudnorm` on the final mix.

## 6. Transcription / subtitles (Gemini, Khmer by default)

Scripts live in `scripts/` next to this file (run them by absolute path; don't copy unless needed):

- `scripts/gemini_transcriber.py` - `transcribe_video(path, audio_path=None, language="Khmer", chunk_seconds=30)`: normalizes audio to 16 kHz mono, splits into chunks, sends each to Gemini, returns `[{"start", "end", "text"}]` in seconds. Rotates across multiple API keys and retries on 408/429/5xx. If Gemini returns plain text instead of timed JSON, timestamps are estimated (split on `។ ៕ . ! ?`) - tell the user timings are approximate in that case.
- `scripts/gemini_client.py` - `GeminiKeyRotator` (`gemini.generate_content(...)`) for other Gemini calls with the same key rotation.
- `scripts/transcribe.py` - CLI wrapper writing SRT (UTF-8 BOM, Khmer-safe) or JSON.

Setup (check first, install only if missing):

```bash
python -c "import google.genai, dotenv" 2>/dev/null || pip install -q google-genai python-dotenv --break-system-packages
```

- Needs `GEMINI_API_KEY` in the environment or a `.env` in the working dir. Several keys may be given separated by `,` `;` or newlines. If none is set, ask the user; never print or echo key values.
- Optional env: `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_CHUNK_SECONDS` (30), `GEMINI_RETRIES_PER_KEY` (2).

```bash
S=<this skill dir>/scripts
python "$S/transcribe.py" in.mp4 -o output/subs.srt                    # Khmer -> SRT
python "$S/transcribe.py" in.mp4 --format json -o output/subs.json     # Khmer -> JSON segments
python "$S/transcribe.py" in.mp4 --language English -o output/en.srt   # other language
python "$S/transcribe.py" in.mp4 --audio clean_voice.wav -o output/subs.srt  # use a cleaner audio track
```

- SRT drops `។ ៕` by default (cleaner captions); pass `--keep-punct` to keep them. A `/` in a segment becomes a line break.
- Gemini transcribes in the spoken language; it never translates. For a translated subtitle, transcribe first, then translate the text yourself and keep the timings.
- Burn Khmer subtitles with a Khmer-capable font, e.g. `-vf "subtitles=output/subs.srt:force_style='FontName=Kantumruy Pro,FontSize=22'"` (check `fc-list | grep -i khmer`; fall back to `Noto Sans Khmer`).
- Audio is sent to Google Gemini. Only transcribe media the user asked for; don't send `./voices/` files.

## 7. Rules

- Work in `./output/`; never overwrite originals in `./voices/` or the user's input media.
- Treat `./voices/` as the user's private voice data: only send it to the three services above, nothing else.
- Chunk-level retry: if one chunk fails on all three services, report which chunk and continue with the rest only if the user agrees.
- Finish by reporting: output file path, duration, which TTS service(s) were used, and the voice mode (for transcription: segment count, language, model, and whether timings were estimated).
