"""Synthesise the music bed and the sound-effects track from story/plan.json.
Run from the project root:  python3 pilot/scripts/audio.py
Outputs pilot/assets/audio/music.wav and sfx.wav (44.1 kHz stereo)."""
import json
import os
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = json.load(open(os.path.join(HERE, "../story/plan.json")))
OUT = os.path.join(HERE, "../assets/audio")
SR = 44100
DUR = PLAN["duration"]
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)


def env(n, a=0.005, r=0.2):
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, min(nr, n)) if nr <= n else 1
    return e


def lowpass(x, alpha):
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha * (x[i] - acc)
        y[i] = acc
    return y


def put(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * gain


def note(freq, dur, kind="pluck"):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    if kind == "pluck":
        s = np.sin(2 * np.pi * freq * tt) + 0.4 * np.sin(4 * np.pi * freq * tt) + 0.15 * np.sin(6 * np.pi * freq * tt)
        return s * np.exp(-tt * 9) * env(n, 0.003, 0.02)
    if kind == "bass":
        s = np.sin(2 * np.pi * freq * tt) + 0.3 * np.sin(4 * np.pi * freq * tt)
        return s * np.exp(-tt * 5) * env(n, 0.004, 0.03)
    s = sum(np.sin(2 * np.pi * freq * d * tt + p) for d, p in ((1, 0), (1.006, 1), (0.994, 2), (2.0, 0.5)))
    return s / 4 * env(n, 0.5, 0.8)


# ------------------------------------------------------------------ music
night = PLAN["cuts"]["night"]
cliff = PLAN["cuts"]["cliffA"]
music = np.zeros(N)
BPM = 132
beat = 60 / BPM
D = 146.83
scale = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5]  # D minor
arp = [0, 2, 4, 2, 0, 4, 6, 4]
k = 0
tt_ = 0.0
while tt_ < DUR - 0.3:
    dark = tt_ >= night
    if not dark:  # bouncy day section: plucks on eighths, bass on beats
        put(music, tt_, note(D * 2 * scale[arp[k % 8]], 0.3), 0.20)
        if k % 2 == 0:
            put(music, tt_, note(D / 2 * (1 if (k // 8) % 2 == 0 else 4 / 3), 0.4, "bass"), 0.42)
    else:  # night: heartbeat bass, sparse high plucks
        if k % 4 in (0, 1):
            put(music, tt_, note(D / 2, 0.35, "bass"), 0.6 if k % 4 == 0 else 0.4)
        if k % 8 == 5:
            put(music, tt_, note(D * 4 * scale[(k // 8) % 3 * 2 % 7], 0.5), 0.10)
    tt_ += beat / 2
    k += 1
for start, f, d, g in ((0, D, night, 0.10), (night, D / 2 * 6 / 5, cliff - night, 0.16),
                       (night, D / 2, DUR - night, 0.20), (cliff, D * 3 / 2 * 16 / 15, DUR - cliff, 0.12)):
    put(music, start, note(f, d, "pad"), g)
# riser into the tower reveal
n = int(1.6 * SR)
tr = np.arange(n) / SR
riser = lowpass(rng.standard_normal(n), 0.08) * (tr / 1.6) ** 2 * 2.5
put(music, cliff - 1.6, riser, 0.35)
music *= np.minimum(1, np.minimum(t / 0.3, (DUR - t) / 1.0)).clip(0, 1)

# -------------------------------------------------------------------- sfx
sfx = np.zeros(N)


def whoosh():
    n = int(0.28 * SR)
    x = rng.standard_normal(n)
    a = np.linspace(0.02, 0.35, n)
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y * np.sin(np.pi * np.arange(n) / n) ** 2 * 2.2


def blip(f0, f1, d=0.14, decay=22):
    n = int(d * SR)
    tt = np.arange(n) / SR
    f = np.linspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * decay) * env(n, 0.002, 0.02)


def hit(d=1.2, f=58, noise=0.5):
    n = int(d * SR)
    tt = np.arange(n) / SR
    body = np.sin(2 * np.pi * (f + 40 * np.exp(-tt * 18)) * tt) * np.exp(-tt * 4)
    crack = lowpass(rng.standard_normal(n), 0.25) * np.exp(-tt * 14) * noise
    return (body + crack) * env(n, 0.002, 0.1)


WH = whoosh()
for e in PLAN["events"]:
    ty, at = e["type"], e["t"]
    if ty == "whoosh":
        put(sfx, at - 0.12, WH, 0.30)
    elif ty == "pop":
        put(sfx, at, blip(520, 1250), 0.6)
        put(sfx, at + 0.05, blip(1560, 1560, 0.3, 9), 0.25)
    elif ty == "tick":
        put(sfx, at, blip(900, 300, 0.12, 30), 0.7)
        put(sfx, at, hit(0.4, 70, 0.3), 0.5)
    elif ty == "rise":
        f = 660 * 2 ** (e["n"] * 2 / 12)
        put(sfx, at, blip(f, f * 1.02, 0.2, 12), 0.5)
    elif ty == "hit":
        put(sfx, at, hit(), 0.9)
    elif ty == "boom":
        put(sfx, at, hit(1.1, 44, 0.9), 1.0)


def save(name, x):
    x = x / max(1e-9, np.abs(x).max()) * 0.89
    st = np.stack([x, x], axis=1)
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((st * 32767).astype("<i2").tobytes())
    print("wrote", name, round(len(x) / SR, 2), "s")


save("music.wav", music)
save("sfx.wav", sfx)
