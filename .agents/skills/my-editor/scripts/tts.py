#!/usr/bin/env python3
"""VoxCPM2 TTS with service fallback, number spelling, noise cleanup and slow-down.

Voice design:  python tts.py --text-file script.txt --out voice.wav \
                   --design "adult man, deep low-pitched male voice, calm" --gender male --slow 0.8
Voice cloning: python tts.py --text "..." --out voice.wav --ref voices/male-1.wav --prompt-text "transcript"

Needs: gradio_client, numpy (gender check only), ffmpeg.
"""
import argparse, os, shutil, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from khmer_numbers import speak_numbers

SERVICES = [
    ("openbmb/VoxCPM-Demo", "HF Space"),
    ("https://gradio-voxcpm2.appkh.online/", "appkh VoxCPM2"),
    ("https://gradio-voxcmp.appkh.online/", "appkh VoxCPM"),
]
TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1"


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def median_f0(path):
    """Median pitch in Hz (autocorrelation); male voices ~85-160, female ~190-300."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
                          "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    n, hop, vals = 640, 320, []
    for i in range(0, len(x) - n, hop):
        w = x[i:i + n]
        if np.sqrt((w ** 2).mean()) < 0.03:
            continue
        w = w - w.mean()
        ac = np.correlate(w, w, "full")[n - 1:]
        lo, hi = 16000 // 400, 16000 // 70
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.5 * ac[0]:
            vals.append(16000 / k)
    return float(np.median(vals)) if vals else 0.0


def gender_ok(path, gender):
    if not gender:
        return True
    f = median_f0(path)
    print(f"  median pitch {f:.0f} Hz", file=sys.stderr)
    return f < 150 if gender == "male" else f > 185


def synthesize(text, design, ref, prompt_text, cfg, normalize=True, denoise=True):
    """Try each service in order; return (raw_audio_path, service_name)."""
    from gradio_client import Client, handle_file
    errors = []
    for url, name in SERVICES:
        try:
            c = Client(url)
            out = c.predict(
                text, design or "",
                handle_file(ref) if ref else None,
                bool(prompt_text), prompt_text or "", cfg, normalize, denoise,
                api_name="/generate")
            if out and os.path.getsize(out) > 1000:
                return out, name
            errors.append(f"{name}: empty audio")
        except Exception as e:  # service down, queued, timeout, bad params
            errors.append(f"{name}: {e}")
        print(f"  {errors[-1]}", file=sys.stderr)
    sys.exit("All TTS services failed:\n" + "\n".join(errors))


def clean(src, dst, slow, loud):
    """Denoise, trim edge silence (start + reversed start), slow down, normalize."""
    af = [f"highpass=f=70,lowpass=f=12000,afftdn=nr=12:nf=-45:tn=1",
          TRIM, "areverse", TRIM, "areverse"]
    if slow and slow != 1.0:
        af.append(f"atempo={slow}")
    af.append(f"loudnorm=I={loud}:TP=-2:LRA=7")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", ",".join(af),
                    "-ar", "44100", "-ac", "1", dst], check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--text")
    g.add_argument("--text-file")
    p.add_argument("--out", required=True)
    p.add_argument("--design", help="voice description (voice design mode)")
    p.add_argument("--ref", help="reference audio (voice cloning mode)")
    p.add_argument("--prompt-text", help="reference transcript; sets use_prompt_text=True (default False)")
    p.add_argument("--gender", choices=["male", "female"], help="retry until pitch matches")
    p.add_argument("--tries", type=int, default=4, help="max attempts for the gender check")
    p.add_argument("--slow", type=float, default=1.0, help="tempo, 0.8 = 25%% slower (default 1.0)")
    p.add_argument("--cfg", type=float, default=2.0)
    p.add_argument("--no-normalize", action="store_true", help="service do_normalize=False (default True)")
    p.add_argument("--no-denoise", action="store_true", help="service denoise=False (default True)")
    p.add_argument("--loudness", type=float, default=-18, help="target LUFS (default -18)")
    p.add_argument("--no-numbers", action="store_true", help="skip number spelling")
    a = p.parse_args()

    text = a.text if a.text is not None else open(a.text_file, encoding="utf-8").read()
    text = " ".join(text.split())
    if not a.no_numbers:
        text = speak_numbers(text)

    ref = a.ref
    if ref:  # clean mono reference, levelled and denoised
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", ref, "-ac", "1", "-ar", "16000",
                        "-t", "20", "-af", "highpass=f=70,afftdn=nr=12:nf=-45,loudnorm=I=-20:TP=-2:LRA=7",
                        tmp], check=True)
        ref = tmp

    tries = a.tries if a.gender else 1
    for t in range(1, tries + 1):
        print(f"attempt {t}/{tries}", file=sys.stderr)
        raw, svc = synthesize(text, a.design, ref, a.prompt_text, a.cfg,
                           not a.no_normalize, not a.no_denoise)
        print(f"  service: {svc}", file=sys.stderr)
        clean(raw, a.out, a.slow, a.loudness)
        if gender_ok(a.out, a.gender):
            break
        print("  gender mismatch, retrying", file=sys.stderr)
    else:
        print(f"WARNING: {a.out} did not pass the {a.gender} check after {tries} tries", file=sys.stderr)
    print(f"{a.out} {duration(a.out):.1f}s")


if __name__ == "__main__":
    main()
