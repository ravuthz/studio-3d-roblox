"""Transcribe audio/video (Khmer by default) with Gemini to SRT or JSON."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gemini_transcriber import transcribe_video  # noqa: E402


def clean_text(text: str) -> str:
    """Drop Khmer sentence marks (។ ៕) and normalize whitespace."""
    cleaned = text.replace("។", "").replace("៕", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def write_srt(segments: list[dict], output: Path, keep_punct: bool) -> None:
    index = 0
    with output.open("w", encoding="utf-8-sig", newline="\n") as file:
        for segment in segments:
            raw = segment.get("text", "")
            raw = re.sub(r"\s+", " ", raw).strip() if keep_punct else clean_text(raw)
            cleaned = re.sub(r"\s*/+\s*", "\n", raw)
            text = "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())
            start, end = segment["start"], segment["end"]

            if not text or end <= start:
                continue

            index += 1
            file.write(f"{index}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("media", help="Input video or audio file")
    parser.add_argument("-o", "--output", help="Output .srt/.json (default: <input>.<format>)")
    parser.add_argument("--format", choices=["srt", "json"], default="srt")
    parser.add_argument("--language", default="Khmer", help='Spoken language (default: "Khmer")')
    parser.add_argument("--audio", help="Optional separate audio file to transcribe instead")
    parser.add_argument("--chunk-seconds", type=int, default=30)
    parser.add_argument("--keep-punct", action="store_true", help="Keep ។ ៕ in SRT text")
    args = parser.parse_args()

    media = Path(args.media).expanduser().resolve()
    if not media.is_file():
        sys.exit(f"Error: input file not found: {media}")

    out = Path(args.output).expanduser().resolve() if args.output else media.with_suffix(f".{args.format}")
    out.parent.mkdir(parents=True, exist_ok=True)

    segments = transcribe_video(
        media,
        args.audio,
        language=args.language,
        chunk_seconds=args.chunk_seconds,
    )

    if args.format == "json":
        out.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        write_srt(segments, out, args.keep_punct)

    print(f"Wrote {len(segments)} segments -> {out}")


if __name__ == "__main__":
    main()
