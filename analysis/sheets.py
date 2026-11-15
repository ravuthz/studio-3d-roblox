"""Timestamped contact sheets (2 fps, 5x4 tiles = 10 s per sheet) built with PIL."""
import glob, os, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

SRC = "/Users/ravuthz/Projects/@data/3d-robox-shorts"
OUT = os.path.dirname(os.path.abspath(__file__))
COLS, ROWS, W = 5, 4, 216
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)

for i, v in enumerate(sorted(glob.glob(os.path.join(SRC, "*.mp4"))), 1):
    d = os.path.join(OUT, f"v{i:02d}", "sheets")
    os.makedirs(d, exist_ok=True)
    tmp = tempfile.mkdtemp()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", v, "-vf", f"fps=2,scale={W}:-2",
                    "-q:v", "3", os.path.join(tmp, "%05d.jpg")], check=True)
    frames = sorted(glob.glob(os.path.join(tmp, "*.jpg")))
    h = Image.open(frames[0]).height
    per = COLS * ROWS
    for s in range(0, len(frames), per):
        sheet = Image.new("RGB", (COLS * W, ROWS * h), "black")
        dr = ImageDraw.Draw(sheet)
        for k, fp in enumerate(frames[s:s + per]):
            x, y = (k % COLS) * W, (k // COLS) * h
            sheet.paste(Image.open(fp), (x, y))
            t = (s + k) / 2
            label = f"{int(t // 60)}:{t % 60:04.1f}"
            dr.rectangle([x, y, x + 62, y + 22], fill="black")
            dr.text((x + 3, y + 1), label, fill="yellow", font=font)
        sheet.save(os.path.join(d, f"s_{s // per + 1:03d}.jpg"), quality=85)
    shutil.rmtree(tmp)
    print(f"v{i:02d}", len(frames), flush=True)
