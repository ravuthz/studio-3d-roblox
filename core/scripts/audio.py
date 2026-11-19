"""Synthesise the music bed and the sound-effects track from <film>/story/plan.json.
Run from the project root:  python3 core/scripts/audio.py <film>
Outputs <film>/assets/audio/music.wav and sfx.wav (44.1 kHz stereo)."""
import json
import os
import sys
import wave

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
if len(sys.argv) < 2:
    sys.exit("Give a film name, e.g. zark (a folder under outputs/)")
FILM = sys.argv[1] if os.path.isabs(sys.argv[1]) else os.path.join(ROOT, "outputs", sys.argv[1])
PLAN = json.load(open(os.path.join(FILM, "story/plan.json"), encoding="utf-8"))
OUT = os.path.join(FILM, "assets/audio")
os.makedirs(OUT, exist_ok=True)
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
# The plan lists mood sections: day (bouncy plucks), warm (slower, major),
# dark (heartbeat bass) and tense (heartbeat plus ticking).
music = np.zeros(N)
BPM = 132
beat = 60 / BPM
D = 146.83
MINOR = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5]
MAJOR = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8]
arp = [0, 2, 4, 2, 0, 4, 6, 4]
secs = PLAN["sections"] or [{"t": 0, "mood": "day"}]


def mood_at(x):
    m = secs[0]["mood"]
    for s_ in secs:
        if s_["t"] <= x:
            m = s_["mood"]
    return m


k = 0
tt_ = 0.0
while tt_ < DUR - 0.3:
    m = mood_at(tt_)
    if m == "day":
        put(music, tt_, note(D * 2 * MINOR[arp[k % 8]], 0.3), 0.20)
        if k % 2 == 0:
            put(music, tt_, note(D / 2 * (1 if (k // 8) % 2 == 0 else 4 / 3), 0.4, "bass"), 0.42)
    elif m == "warm":
        if k % 2 == 0:
            put(music, tt_, note(D * 2 * MAJOR[arp[(k // 2) % 8]], 0.6), 0.22)
        if k % 8 == 0:
            put(music, tt_, note(D / 2 * (1 if (k // 16) % 2 == 0 else 3 / 2), 0.8, "bass"), 0.4)
    else:
        if k % 4 in (0, 1):
            put(music, tt_, note(D / 2, 0.35, "bass"), 0.6 if k % 4 == 0 else 0.4)
        if m == "tense":
            put(music, tt_, note(D * 4 * MINOR[(k * 3) % 7], 0.12), 0.07)
        elif k % 8 == 5:
            put(music, tt_, note(D * 4 * MINOR[(k // 8) % 3 * 2 % 7], 0.5), 0.10)
    tt_ += beat / 2
    k += 1
for i, s_ in enumerate(secs):
    end = secs[i + 1]["t"] if i + 1 < len(secs) else DUR
    f = {"day": D, "warm": D * 5 / 4, "dark": D / 2 * 6 / 5, "tense": D / 2 * 16 / 15}[s_["mood"]]
    if end - s_["t"] > 1.6:
        put(music, s_["t"], note(f, end - s_["t"], "pad"), 0.13)
        put(music, s_["t"], note(D / 2, end - s_["t"], "pad"), 0.10)
for e in PLAN["events"]:  # noise risers into the big hits
    if e["type"] in ("hit", "boom") and e["t"] > 2:
        n = int(1.2 * SR)
        tr = np.arange(n) / SR
        put(music, e["t"] - 1.2, lowpass(rng.standard_normal(n), 0.08) * (tr / 1.2) ** 2 * 2.5, 0.22)
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
