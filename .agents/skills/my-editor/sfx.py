#!/usr/bin/env python3
"""Synthesize simple sound effects with NumPy/SciPy.

Usage:
    python sfx.py list
    python sfx.py <name> out.wav [--dur SECONDS] [--vol 0.0-1.0]
    python sfx.py all ./output/sfx          # render every preset into a folder

Install: pip install numpy scipy --break-system-packages
"""
import argparse
import os
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 44100


def _t(dur):
    return np.linspace(0, dur, int(SR * dur), False)


def _norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def _filter(x, kind, cutoff):
    sos = butter(4, cutoff, btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def _fade(x, ms=5):
    n = min(int(SR * ms / 1000), len(x) // 2)
    if n > 0:
        x[:n] *= np.linspace(0, 1, n)
        x[-n:] *= np.linspace(1, 0, n)
    return x


# ---- presets -------------------------------------------------------------

def whoosh(dur=0.8):
    t = _t(dur)
    noise = np.random.randn(len(t))
    # bandpass sweep: low -> high -> low
    out = np.zeros_like(noise)
    seg = 2048
    for i in range(0, len(noise), seg):
        p = i / len(noise)
        c = 400 + 4000 * np.sin(np.pi * p)
        out[i:i + seg] = _filter(noise[i:i + seg], "lowpass", min(c, SR / 2 - 100))
    env = np.sin(np.pi * t / dur) ** 2
    return _norm(out * env)


def swoosh(dur=0.4):
    return whoosh(dur)


def click(dur=0.05):
    t = _t(dur)
    return _norm(np.random.randn(len(t)) * np.exp(-t * 120))


def pop(dur=0.15):
    t = _t(dur)
    f = 600 * np.exp(-25 * t) + 120
    return _norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-18 * t))


def beep(dur=0.25, freq=1000):
    t = _t(dur)
    return _fade(_norm(np.sin(2 * np.pi * freq * t)))


def ding(dur=1.0):
    t = _t(dur)
    out = sum(a * np.sin(2 * np.pi * f * t) for f, a in
              [(880, 1.0), (1760, 0.5), (2637, 0.25)])
    return _norm(out * np.exp(-4 * t))


def laser(dur=0.35):
    t = _t(dur)
    f = 1800 * np.exp(-6 * t) + 200
    return _norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-5 * t))


def riser(dur=2.0):
    t = _t(dur)
    f = 200 * (1 + 8 * (t / dur) ** 2)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    noise = _filter(np.random.randn(len(t)), "highpass", 1500) * 0.4
    return _fade(_norm((tone + noise) * (t / dur)), 20)


def impact(dur=1.2):
    t = _t(dur)
    boom = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-3 * t) + 35) / SR) * np.exp(-3.5 * t)
    crack = _filter(np.random.randn(len(t)), "lowpass", 3000) * np.exp(-14 * t)
    return _norm(boom + 0.6 * crack)


def rain(dur=4.0):
    n = np.random.randn(int(SR * dur))
    return _fade(_norm(_filter(n, "highpass", 800) * 0.8), 100)


def typing(dur=2.0):
    out = np.zeros(int(SR * dur))
    pos = 0.0
    while pos < dur - 0.06:
        c = click(0.04) * np.random.uniform(0.5, 1.0)
        i = int(pos * SR)
        out[i:i + len(c)] += c
        pos += np.random.uniform(0.07, 0.22)
    return _norm(out)


def transition(dur=0.7):
    n = int(SR * dur)
    p = np.pad(pop(0.15), (0, max(0, n - int(SR * 0.15))))[:n]
    return _norm(whoosh(dur) * 0.8 + p * 0.5)


PRESETS = {
    "whoosh": whoosh, "swoosh": swoosh, "transition": transition, "click": click, "pop": pop,
    "beep": beep, "ding": ding, "laser": laser, "riser": riser,
    "impact": impact, "rain": rain, "typing": typing,
}


def save(x, path, vol=1.0):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    wavfile.write(path, SR, (np.clip(x * vol, -1, 1) * 32767).astype(np.int16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--dur", type=float)
    ap.add_argument("--vol", type=float, default=1.0)
    a = ap.parse_args()

    if a.name == "list":
        print("\n".join(PRESETS))
        return
    if a.name == "all":
        folder = a.out or "./output/sfx"
        for k, fn in PRESETS.items():
            save(fn(), os.path.join(folder, f"{k}.wav"), a.vol)
        print(f"rendered {len(PRESETS)} effects into {folder}")
        return
    if a.name not in PRESETS or not a.out:
        sys.exit(f"usage: sfx.py <{'|'.join(PRESETS)}|all|list> out.wav [--dur S] [--vol V]")
    fn = PRESETS[a.name]
    save(fn(a.dur) if a.dur else fn(), a.out, a.vol)
    print(a.out)


if __name__ == "__main__":
    main()