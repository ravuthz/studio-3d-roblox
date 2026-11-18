from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
MAX_RETRIES_PER_KEY = int(os.getenv("GEMINI_RETRIES_PER_KEY", "2"))
DEFAULT_CHUNK_SECONDS = int(os.getenv("GEMINI_CHUNK_SECONDS", "30"))

RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


# ---------------------------------------------------------------------------
# API keys and errors
# ---------------------------------------------------------------------------

def load_gemini_keys() -> list[str]:
    """
    Load unique keys from GEMINI_API_KEY.

    Supports comma-, semicolon-, or newline-separated keys.
    """
    raw = os.getenv("GEMINI_API_KEY", "")

    keys = [
        value.strip().strip("'\"")
        for value in re.split(r"[,;\r\n]+", raw)
        if value.strip()
    ]

    # Preserve configured order while removing duplicates.
    keys = list(dict.fromkeys(keys))

    if not keys:
        raise RuntimeError(
            "No Gemini API keys found. Add GEMINI_API_KEY to your .env file."
        )

    return keys


def get_error_status(exc: Exception) -> int | None:
    """Extract the HTTP status code from a Google GenAI SDK exception."""
    for attr in ("code", "status_code"):
        value = getattr(exc, attr, None)

        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                pass

    return None


def is_retryable_error(exc: Exception) -> bool:
    """Return True for rate limits and transient API/network failures."""
    status = get_error_status(exc)

    if status is not None:
        return status in RETRYABLE_STATUS_CODES

    # Some transport exceptions don't expose an HTTP status.
    name = type(exc).__name__.lower()
    message = str(exc).lower()

    if any(
        term in name
        for term in ("timeout", "connection", "transport")
    ):
        return True

    return any(
        term in message
        for term in (
            "timed out",
            "timeout",
            "connection reset",
            "connection error",
            "temporarily unavailable",
            "service unavailable",
            "resource exhausted",
            "rate limit",
            "429",
            "500",
            "502",
            "503",
            "504",
        )
    )


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def run_command(args: list[str]) -> str:
    """Run a command and raise an informative error on failure."""
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed:\n{' '.join(args)}\n\n"
            f"{result.stderr.strip()}"
        )

    return result.stdout.strip()


def require_ffmpeg() -> None:
    """Check that FFmpeg and FFprobe are installed."""
    for executable in ("ffmpeg", "ffprobe"):
        try:
            subprocess.run(
                [executable, "-version"],
                capture_output=True,
                check=True,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            raise RuntimeError(
                f"{executable} was not found. Install FFmpeg first."
            ) from exc


def get_duration(path: Path) -> float:
    """Return the media duration in seconds."""
    output = run_command([
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])

    try:
        duration = float(output)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            f"Could not determine duration for {path}"
        ) from exc

    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError(f"Invalid media duration: {duration}")

    return duration


def normalize_audio(source: Path, destination: Path) -> None:
    """Convert the source to mono, 16 kHz, PCM WAV."""
    run_command([
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(source),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        str(destination),
    ])


def split_audio(
    wav_path: Path,
    chunks_dir: Path,
    chunk_seconds: int,
) -> list[Path]:
    """Split a WAV file into numbered WAV chunks."""
    chunks_dir.mkdir(parents=True, exist_ok=True)

    run_command([
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(wav_path),
        "-f", "segment",
        "-segment_time", str(chunk_seconds),
        "-c:a", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(chunks_dir / "chunk_%05d.wav"),
    ])

    chunks = sorted(chunks_dir.glob("chunk_*.wav"))

    if not chunks:
        raise RuntimeError("FFmpeg did not produce any audio chunks.")

    return chunks


# ---------------------------------------------------------------------------
# Gemini response extraction
# ---------------------------------------------------------------------------

def _text_from_value(value: Any) -> str:
    """Extract readable text from SDK response values."""
    if value is None:
        return ""

    if isinstance(value, str):
        return value.strip()

    if isinstance(value, dict):
        for key in ("text", "transcript", "transcription"):
            candidate = value.get(key)

            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        return ""

    for attr in ("text", "transcript", "transcription"):
        candidate = getattr(value, attr, None)

        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    return ""


def extract_gemini_text(response: Any) -> str:
    """
    Extract ordinary text and audio_transcription parts.

    Avoid relying exclusively on response.text because some Gemini responses
    contain audio_transcription parts rather than regular text parts.
    """
    collected: list[str] = []

    candidates = getattr(response, "candidates", None) or []

    for candidate in candidates:
        content = getattr(candidate, "content", None)

        if content is None:
            continue

        parts = getattr(content, "parts", None) or []

        for part in parts:
            # Normal text output.
            part_text = getattr(part, "text", None)

            if isinstance(part_text, str) and part_text.strip():
                collected.append(part_text.strip())
                continue

            # Audio transcription output.
            transcription = getattr(part, "audio_transcription", None)

            if transcription is not None:
                transcription_text = _text_from_value(transcription)

                if transcription_text:
                    collected.append(transcription_text)
                    continue

            # Compatibility with SDK/model response variants.
            part_dict = None

            try:
                if hasattr(part, "model_dump"):
                    part_dict = part.model_dump(
                        exclude_none=True,
                        mode="python",
                    )
                elif isinstance(part, dict):
                    part_dict = part
            except Exception:
                part_dict = None

            if isinstance(part_dict, dict):
                for key in (
                    "audio_transcription",
                    "transcription",
                    "transcript",
                    "text",
                ):
                    value = part_dict.get(key)
                    extracted = _text_from_value(value)

                    if extracted:
                        collected.append(extracted)
                        break

    # Use response.text only as a fallback.
    # Accessing this property may trigger the SDK's non-text-parts warning.
    if not collected:
        try:
            fallback = getattr(response, "text", None)

            if isinstance(fallback, str) and fallback.strip():
                collected.append(fallback.strip())
        except Exception:
            pass

    # Remove exact duplicates while preserving order.
    unique: list[str] = []

    for text in collected:
        if text not in unique:
            unique.append(text)

    return "\n".join(unique).strip()


# ---------------------------------------------------------------------------
# Parsing and fallback timestamp estimation
# ---------------------------------------------------------------------------

def parse_json_segments(text: str) -> list[dict] | None:
    """
    Parse timestamped JSON from Gemini.

    Returns None if the response is plain transcription text instead.
    """
    cleaned = text.strip()

    cleaned = re.sub(
        r"^\s*```(?:json)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)

    # Try the complete response first.
    candidates = [cleaned]

    # Then try to recover a JSON object embedded in explanatory text.
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)

    if match and match.group(0) != cleaned:
        candidates.append(match.group(0))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        if not isinstance(data, dict):
            continue

        segments = data.get("segments")

        if not isinstance(segments, list):
            continue

        parsed = []

        for item in segments:
            if not isinstance(item, dict):
                continue

            try:
                start = float(item["start"])
                end = float(item["end"])
                segment_text = str(item["text"]).strip()
            except (KeyError, TypeError, ValueError):
                continue

            if (
                not math.isfinite(start)
                or not math.isfinite(end)
                or start < 0
                or end <= start
                or not segment_text
            ):
                continue

            parsed.append({
                "start": start,
                "end": end,
                "text": segment_text,
            })

        return parsed

    return None


def split_sentences(text: str) -> list[str]:
    """Split plain transcription into sentence-like subtitle units."""
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return []

    # Khmer punctuation: ។ and ៕; also support common Latin punctuation.
    pieces = re.split(r"(?<=[។៕!?])\s+|(?<=[.!?])\s+", text)

    sentences = [piece.strip() for piece in pieces if piece.strip()]

    # If the transcription has no punctuation, divide it into manageable
    # units by whitespace where possible. Khmer word boundaries are not
    # always represented by spaces, so these are only approximations.
    if len(sentences) == 1 and len(sentences[0]) > 100:
        words = sentences[0].split()
        groups: list[str] = []
        current: list[str] = []
        current_length = 0

        for word in words:
            if current and current_length + len(word) + 1 > 80:
                groups.append(" ".join(current))
                current = []
                current_length = 0

            current.append(word)
            current_length += len(word) + 1

        if current:
            groups.append(" ".join(current))

        if len(groups) > 1:
            sentences = groups

    return sentences


def estimate_segments(
    text: str,
    duration: float,
) -> list[dict]:
    """
    Estimate timestamps for plain text when Gemini returns no JSON timings.

    These timings are approximate, not word-aligned speech recognition.
    """
    sentences = split_sentences(text)

    if not sentences or duration <= 0:
        return []

    weights = [max(1, len(sentence)) for sentence in sentences]
    total_weight = sum(weights)

    segments: list[dict] = []
    cursor = 0.0

    for index, (sentence, weight) in enumerate(zip(sentences, weights)):
        if index == len(sentences) - 1:
            end = duration
        else:
            end = cursor + duration * weight / total_weight

        if end > cursor:
            segments.append({
                "start": round(cursor, 3),
                "end": round(end, 3),
                "text": sentence,
            })

        cursor = end

    return segments


# ---------------------------------------------------------------------------
# Main transcription function
# ---------------------------------------------------------------------------

def transcribe_video(
    video_path: str | Path,
    audio_path: str | Path | None = None,
    *,
    language: str = "Khmer",
    chunk_seconds: int = DEFAULT_CHUNK_SECONDS,
) -> list[dict]:
    """
    Transcribe audio from a video using Gemini.

    Args:
        video_path: Video file to transcribe.
        audio_path: Optional separate source-audio file.
        language: Spoken language, e.g. "Khmer" or "English".
        chunk_seconds: Approximate duration of each uploaded audio chunk.

    Returns:
        A list of dictionaries:
        [
            {"start": 0.0, "end": 2.5, "text": "..."},
            ...
        ]

        Timestamps are seconds relative to the start of the source video.
    """
    video_path = Path(video_path).expanduser().resolve()

    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    if chunk_seconds < 1:
        raise ValueError("chunk_seconds must be at least 1.")

    keys = load_gemini_keys()
    require_ffmpeg()

    print(f"[Gemini] Model: {GEMINI_MODEL}")
    print(f"[Gemini] Configured API keys: {len(keys)}")
    print(f"[Gemini] Chunk size: {chunk_seconds}s")

    # Prefer a caller-supplied audio file, if available.
    source_audio = (
        Path(audio_path).expanduser().resolve()
        if audio_path is not None
        else video_path
    )

    if not source_audio.is_file():
        raise FileNotFoundError(f"Audio file not found: {source_audio}")

    with tempfile.TemporaryDirectory(prefix="gemini-transcribe-") as tmp:
        tmp_dir = Path(tmp)
        wav_path = tmp_dir / "normalized.wav"
        chunks_dir = tmp_dir / "chunks"

        print("[Gemini] Preparing audio...")
        normalize_audio(source_audio, wav_path)

        chunks = split_audio(
            wav_path,
            chunks_dir,
            chunk_seconds,
        )

        total_chunks = len(chunks)
        all_segments: list[dict] = []
        next_key_index = 0

        for chunk_index, chunk_path in enumerate(chunks):
            chunk_offset = chunk_index * chunk_seconds
            chunk_duration = get_duration(chunk_path)

            print(
                f"[Gemini] Transcribing chunk {chunk_index + 1}/"
                f"{total_chunks} at {chunk_offset:.1f}s..."
            )

            audio_bytes = chunk_path.read_bytes()

            prompt = f"""
Transcribe the speech in this audio accurately in {language}.

This is an existing recording. Transcribe the actual spoken words.
Do not generate new speech, translate, summarize, or invent content.

Requirements:
- Preserve the original Khmer words and spelling when the language is Khmer.
- Do not translate the speech into another language.
- Ignore non-speech sounds.
- Divide the speech into short, natural subtitle segments.
- Estimate the start and end of each spoken phrase as accurately as possible.
- All timestamps must be seconds relative to the beginning of THIS audio chunk.
- Start must be non-negative and end must be greater than start.
- Do not place timestamps beyond the duration of this chunk ({chunk_duration:.3f} seconds).
- Return ONLY valid JSON. Do not use Markdown fences.

Required response format:
{{
  "segments": [
    {{
      "start": 0.0,
      "end": 2.5,
      "text": "The original words spoken"
    }}
  ]
}}

If there is no intelligible speech, return:
{{"segments": []}}
"""

            response_text: str | None = None
            last_error: Exception | None = None

            # Try each key. Each key gets a limited number of attempts.
            for key_attempt in range(len(keys)):
                key_index = (next_key_index + key_attempt) % len(keys)
                api_key = keys[key_index]

                for retry in range(MAX_RETRIES_PER_KEY):
                    try:
                        client = genai.Client(api_key=api_key)

                        response = client.models.generate_content(
                            model=GEMINI_MODEL,
                            contents=[
                                types.Part.from_bytes(
                                    data=audio_bytes,
                                    mime_type="audio/wav",
                                ),
                                prompt,
                            ],
                            # Intentionally omit response_mime_type:
                            # some model configurations reject JSON mode.
                            config=types.GenerateContentConfig(
                                temperature=0,
                            ),
                        )

                        extracted = extract_gemini_text(response)

                        if extracted:
                            response_text = extracted
                            break

                        # Empty output may be a transient/model response issue.
                        raise RuntimeError(
                            "Gemini returned no readable text. "
                            "Inspect the response's candidates and parts."
                        )

                    except Exception as exc:
                        last_error = exc

                        if not is_retryable_error(exc):
                            # Do not rotate through all keys for invalid
                            # arguments, unsupported models, or bad requests.
                            raise RuntimeError(
                                f"Gemini request failed on key "
                                f"{key_index + 1}/{len(keys)}: {exc}"
                            ) from exc

                        print(
                            f"[Gemini] Chunk {chunk_index + 1}: "
                            f"key {key_index + 1}/{len(keys)}, "
                            f"attempt {retry + 1}/{MAX_RETRIES_PER_KEY} "
                            f"failed: {exc}"
                        )

                        if retry + 1 < MAX_RETRIES_PER_KEY:
                            time.sleep(min(2 ** retry, 8))

                if response_text:
                    # Start the next chunk with the next key, distributing
                    # requests across configured keys.
                    next_key_index = (key_index + 1) % len(keys)
                    break

                next_key_index = (key_index + 1) % len(keys)

            if not response_text:
                raise RuntimeError(
                    f"All {len(keys)} API keys failed for chunk "
                    f"{chunk_index + 1}/{total_chunks}. "
                    f"Last error: {last_error}"
                ) from last_error

            # Prefer genuine timestamped JSON when available.
            chunk_segments = parse_json_segments(response_text)

            if chunk_segments is None:
                print(
                    f"[Gemini] Chunk {chunk_index + 1}: "
                    "received plain transcription text; "
                    "estimating subtitle timestamps."
                )

                chunk_segments = estimate_segments(
                    response_text,
                    chunk_duration,
                )

            # Validate, clamp to chunk duration, and shift timestamps.
            for segment in chunk_segments:
                start = float(segment["start"])
                end = float(segment["end"])
                text = str(segment["text"]).strip()

                start = max(0.0, min(start, chunk_duration))
                end = max(0.0, min(end, chunk_duration))

                if not text or end <= start:
                    continue

                all_segments.append({
                    "start": round(chunk_offset + start, 3),
                    "end": round(chunk_offset + end, 3),
                    "text": text,
                })

            print(
                f"[Gemini] Completed chunk {chunk_index + 1}/"
                f"{total_chunks}; {len(all_segments)} segments collected."
            )

        # Sort and remove adjacent exact duplicates.
        all_segments.sort(key=lambda item: (item["start"], item["end"]))

        cleaned: list[dict] = []

        for segment in all_segments:
            if cleaned:
                previous = cleaned[-1]

                same_text = (
                    segment["text"].strip() == previous["text"].strip()
                )
                near_same_start = (
                    abs(segment["start"] - previous["start"]) < 1.0
                )

                if same_text and near_same_start:
                    continue

            cleaned.append(segment)

        print(
            f"[Gemini] Finished: {len(cleaned)} subtitle segments."
        )

        return cleaned
