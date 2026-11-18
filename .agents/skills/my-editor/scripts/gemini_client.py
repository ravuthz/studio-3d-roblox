import os
import time
from itertools import cycle

from dotenv import load_dotenv
from google import genai
from google.genai import errors

load_dotenv()


def load_api_keys() -> list[str]:
    raw = os.getenv("GEMINI_API_KEY", "")
    keys = raw.replace(";", ",").replace("\n", ",").split(",")
    keys = [key.strip() for key in keys if key.strip()]

    if not keys:
        raise RuntimeError("No Gemini API keys configured in GEMINI_API_KEY")

    return list(dict.fromkeys(keys))


class GeminiKeyRotator:
    def __init__(self):
        self.keys = load_api_keys()
        self.index = 0

    def generate_content(self, **kwargs):
        last_error = None

        # Try every configured key once for this request.
        for attempt in range(len(self.keys)):
            key_index = (self.index + attempt) % len(self.keys)
            client = genai.Client(api_key=self.keys[key_index])

            try:
                response = client.models.generate_content(**kwargs)
                self.index = key_index
                return response

            except errors.APIError as exc:
                last_error = exc
                status = getattr(exc, "code", None)

                # Rotate for quota/rate limits or temporary server errors.
                if status in (429, 500, 502, 503, 504):
                    print(
                        f"Gemini key {key_index + 1}/{len(self.keys)} "
                        f"failed (HTTP {status}); trying another key..."
                    )
                    continue

                # Invalid key, permissions, malformed request, etc.
                raise

        raise RuntimeError(
            f"All {len(self.keys)} Gemini API keys failed for this request. "
            "Check quota, project limits, and billing."
        ) from last_error


gemini = GeminiKeyRotator()