# 3D blocky story films

Vertical story shorts (1080×1920, 30 fps) made entirely from code: blocky characters, one-word
captions, a cut on every phrase and first-person narration, in the "In this town…" format.

| Step | Tool |
|---|---|
| Characters, clips, sets and props | Blender, scripted headless, exported as GLB |
| Narration with word timings | ElevenLabs |
| Staging, cameras, lighting, effects | Three.js |
| Captions, audio mix, MP4 render | HyperFrames |
| Music and sound effects | Python (numpy) |

The cast is a fixed family: **Zero** (the kid who narrates), **Zeebra** (elder brother),
**Luna** (mother) and **Zip** (father). Each film adds its own characters.

## Requirements

- Node.js 22+ and FFmpeg
- Blender (only to rebuild the shared assets)
- Python 3 with `numpy` (for music and effects)
- An ElevenLabs key in `.env.local`:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

`.env.local` is git-ignored. Run `npm install` once after cloning.

## Layout

```
core/        shared by every film: engine, captions, assets, scripts, template, vendor libraries
outputs/     one folder per film (git-ignored): story, film code, audio, renders
analysis/    notes from studying ten reference shorts (see analysis/ANALYSIS.md)
AGENTS.md    full reference for AI agents and contributors
```

A film folder holds only what is specific to it: `story/story.json` (script, cuts, moods, sound
cues) and `film.js` (extra characters and the shot list). Everything else comes from `core/`.

## Make a film

Scaffold a new film folder:

```bash
npm run film new my-film "In this town, ..."
```

Edit `outputs/my-film/story/story.json` and `outputs/my-film/film.js`, then build it:

```bash
npm run film build my-film
```

The result is `outputs/my-film/renders/my-film.mp4`. `build` runs these steps, which can also be
run one at a time:

| Command | What it does |
|---|---|
| `npm run film voice <name>` | Narration and word timings. Cached; spends ElevenLabs credits only when the text or voice changes. |
| `npm run film plan <name>` | Cut times, sound events and durations from the timings. |
| `npm run film audio <name>` | Synthesised music and sound effects. |
| `npm run film check <name>` | HyperFrames lint. |
| `npm run film shots <name> [ids]` | Snapshot the middle frame of every shot, to review before rendering. |
| `npm run film render <name>` | Render the MP4. |
| `npm run film assets` | Rebuild the shared GLB assets with Blender. |

To preview a film in the browser, serve it with HyperFrames:

```bash
npx hyperframes preview outputs/my-film
```

## Existing films

Both live under `outputs/` and are not in git.

- **zero-pilot** (30 s): everyone in town is born with a number above their head, and Zero's is zero.
- **zark** (2 min): the town hunts a green alien who secretly lives under Zero's bed.

## Notes

- Films are original stories. The reference shorts informed the format and pacing only.
- The music and effects are simple synthesised placeholders.
- `outputs/` is ignored by git, so back up film sources separately.
- See [AGENTS.md](AGENTS.md) for the story file fields, the engine reference and lessons learned.
