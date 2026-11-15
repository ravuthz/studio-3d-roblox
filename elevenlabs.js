import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Load .env.local when the process was not started with `node --env-file=.env.local`.
if (!process.env.ELEVENLABS_API_KEY) {
  try {
    process.loadEnvFile(new URL(".env.local", import.meta.url));
  } catch {
    // No .env.local here; the SDK will report the missing key on first use.
  }
}

// The SDK reads ELEVENLABS_API_KEY from the environment.
export const elevenlabs = new ElevenLabsClient();

// Default voice for text-to-speech calls; override with ELEVENLABS_VOICE_ID.
export const DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "CwhRBWXzGAHq8TQ4Fs17";
