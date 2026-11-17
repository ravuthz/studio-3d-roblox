# 3D blocky story films

Code-driven vertical story shorts (9:16, 1080×1920, 30 fps, **2–3 minutes by default**) in the
"In this town…" format: blocky characters, one-word captions, a cut on every phrase, first-person
narration. Blender builds the assets, VoxCPM2 (through the `/my-editor` skill) speaks the narration
in a cloned voice from `voices/`, Three.js stages every shot, HyperFrames composites and renders the MP4.

## Defaults for every film

- **Format**: 9:16 vertical, 1080×1920, 30 fps.
- **Length**: 2–3 minutes of narration plus the tail, unless the user asks for another length.
- **Narration voice**: always generated with the `/my-editor` skill in voice-cloning mode, using
  these references and no others:

  | Language | Reference              |
  | -------- | ---------------------- |
  | Khmer    | `./voices/ravuthz.mp3` |
  | English  | `./voices/in-town.mp3` |

  Do not use ElevenLabs voices or `/my-editor` voice design for narration. See
  "Narration with /my-editor" below.

## Layout

```
core/                 shared by every film — change here only what all films should get
  blender/build_assets.py   rig, hair, clips, town, extra sets and props → core/assets/*.glb
  assets/                   character.glb, town.glb, sets.glb
  engine/stage.js           renderer, lights, film grade, cast and clothing, crowd, props, cameras, createFilm()
  engine/textures.js        procedural surface textures (brick, asphalt, wood, fabric…) and printed cloth
  engine/captions.js        one-word captions and flashes from the word timings
  scripts/                  film.mjs (CLI), narrate.py, tts.mjs (legacy), plan.mjs, audio.py
  template/                 files a new film starts from
  vendor/                   three.js, gsap, Fredoka font (no CDN at render time)
outputs/<film>/       one folder per film — only what is specific to that film
  story/story.json          script, cuts, moods, sound cues (the source of truth)
  film.js                   cast additions, film textures, the shot list
  index.html                page from the template (title and durations are patched by `plan`)
  core -> ../../core        symlink so the page can load the shared engine and assets
  story/timing.js, plan.js, plan.json, alignment.json   generated
  assets/audio/vo.mp3, music.wav, sfx.wav                generated
  .cache/vo/                                             narration chunks (generated)
  renders/<film>.mp4                                      generated
analysis/             notes and scripts from studying ten reference shorts (ANALYSIS.md)
voices/               narration references for /my-editor: in-town.mp3 (English), ravuthz.mp3 (Khmer)
elevenlabs.js         ElevenLabs client (legacy narration); key and ELEVENLABS_VOICE_ID come from .env.local
```

`outputs/` is git-ignored, so film sources are not versioned unless that rule is changed.

## Rules for new films

1. Every new film is a new folder in `outputs/`, created with `npm run film new <name> "Title"`.
   Never copy the engine, vendor files, scripts or GLB assets into a film.
2. A film extends the core: it imports from `core/stage.js` and calls `createFilm({...})`.
   Film-only characters, textures and helper functions live in that film's `film.js`.
3. If something would be useful to a second film (a clip, a prop, a set, a helper, a face style),
   add it to `core/` and export it, then use it from the film. Check the other films still render.
4. Films are original stories. The reference shorts are for format and pacing only; do not reuse
   their scripts, characters or shots.
5. The family is fixed: Zero (narrator, the kid), Zeebra (elder brother), Luna (mother), Zip (father).
6. Never read, print or commit `.env.local`. The voice step reads the key itself.
7. Narration always uses the `/my-editor` voice clone for the film's language (English:
   `voices/in-town.mp3`, Khmer: `voices/ravuthz.mp3`). Never overwrite or edit files in `voices/`.
8. A new film is 9:16 and 2–3 minutes long unless the user asks otherwise.

## Commands

```bash
npm run film new <name> "Title"   # scaffold outputs/<name>/
npm run film narrate <name>       # /my-editor voice-clone narration + word timings (cached per line)
npm run film voice <name>         # LEGACY ElevenLabs narration for older films
npm run film plan <name>          # cut times, sound events, durations
npm run film audio <name>         # synthesised music and effects (needs python with numpy)
npm run film check <name>         # HyperFrames lint
npm run film shots <name> [ids]   # snapshot the middle frame of every shot, or of the listed cut ids
npm run film render <name>        # outputs/<name>/renders/<name>.mp4
npm run film build <name>         # narrate (voice for films without "lang") → plan → audio → check → render
npm run film assets               # rebuild core/assets with Blender (after editing build_assets.py)
```

Preview in the browser: the `film-preview` entry in `.claude/launch.json` serves one film on
port 3002; change its `outputs/<name>` argument to preview another film.

## Making a film, step by step

1. **Script** in `story/story.json`: 2–3 minutes by default. For English, about 2.9 words per second
   (≈350–520 words); for Khmer, time a test line with the clone and size the script to fit. Follow the template in `analysis/ANALYSIS.md`: rule hook in 4 s, list of examples,
   "my name is…", turn at 40–60 %, twists at 60–90 %, cliffhanger or reversal at the end.
2. **Cuts**: each line starts a shot; add `cuts` words so the average shot is 1.6–2.1 s.
3. `narrate` (next section), then `plan`. Read the printed shot count and
   average length, and check the narration lands between 2 and 3 minutes.
4. **Stage** each cut id in `film.js`. Every shot gets a camera move (usually a slow push).
5. `shots`, then **read the contact sheets** under `outputs/<name>/.hyperframes/artifacts/snapshots/`.
   Fix framing, blocked faces and blown-out light; repeat with the ids you changed.
6. `audio`, `check`, `render`. Confirm the MP4 duration with `ffprobe` and look at decoded frames.

### story.json line fields

| Field                        | Meaning                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `id`, `text`                 | The line. Its cut id is `<id>`; the narration text is exactly `text`.           |
| `cuts: [word]`               | Words that start further shots: `<id>.1`, `<id>.2`, … (searched in order).      |
| `big: [word]`                | Caption words shown larger.                                                     |
| `marks: {name: word}`        | Named times for film code: `PLAN.marks.name` is the start of that word.         |
| `hits`, `pops`, `flash: [k]` | Sound hit, pop or white flash on cut `k` of the line (0 = line start).          |
| `sfx: [[type, at]]`          | Extra sound: `at` is a word or a cut index; type `pop`, `tick`, `hit`, `rises`. |
| `mood`                       | Music from this line on: `day`, `warm`, `dark`, `tense`.                        |

Top level: `title`, `names` (words captions keep capitalised), `voice` (model, speed, stability,
similarity, style), optional `voiceId`. A `tail` shot is added automatically after the narration.
Add `"lang": "en"` or `"lang": "km"` to pick the narration voice (English is the default).

## Narration with /my-editor

`npm run film narrate <name>` (`core/scripts/narrate.py`) runs the `/my-editor` voice-clone
workflow for the whole film:

- **Reference**: `voices/in-town.mp3` for English (`"lang": "en"`, the default), `voices/ravuthz.mp3`
  for Khmer (`"lang": "km"`). The reference is cleaned into a temp file; `voices/` is never written.
- **One chunk per story line**, synthesised with `<my-editor>/scripts/tts.py --ref ...` (VoxCPM2
  with its three-service fallback). Chunks are cached in `outputs/<film>/.cache/vo/` by line text,
  so changing one line only regenerates that line. `--redo id,id` forces chosen lines again.
  Khmer numbers are spelled out for the TTS only; captions keep `text`.
- Chunks are joined with 0.3 s pauses (0.55 s before a `mood` change), levelled with one `loudnorm`,
  and written to `assets/audio/vo.mp3`.
- **Timings**: word times come from local faster-whisper (`small.en`) aligned to the script words;
  words it misses, and all Khmer words, are spread over the gap by character length. The result is
  `story/timing.js` in the format `plan` and the captions read.
- It needs a Python with `numpy`, `gradio_client` and `faster_whisper` (set `NARRATE_PYTHON` if the
  CLI does not find one). It prints the services used and any line whisper heard differently.
- After it finishes, listen for lines that sound different (a fallback service can change the
  voice) and regenerate them with `--redo`.
- Khmer captions need a Khmer-capable font; Fredoka has no Khmer glyphs.

## Engine reference (`core/engine/stage.js`)

```js
import { createFilm, A, crowd, put, cam, v3, ... } from "core/stage.js";
createFilm({
  id: "my-film",
  cast: { name: { hair, scale, chest, face, glow, col, fit, cloth } },  // added to the family
  chests: { name: (g) => {} },                              // 256×256 chest decals
  board: (g, w, h) => {},                                   // tower screen, 512×1024
  setup() {},                                               // build film-only textures once loaded
  shots: [[cutId, "set mood", (t, u, s) => {}], ...],       // t seconds, u 0..1, s shot start
});
```

- **Determinism**: a shot is a pure function of `t`. No clocks, no `Math.random()` (use `mulberry32`),
  no state carried between frames. The stage is reset before every shot.
- **Space**: units are studs; a character is about 5 tall and faces +Z at `ry = 0`. The street runs
  along Z with the tower at z ≈ −72; Zero's mark is `(0, 8)`. Cameras looking toward −Z see faces.
- **Sets** (first word of the env string): `town`, `house` (town + the family house at z = 64, facing −Z),
  `room` (Zero's bedroom; use `R(x, y, z)`), `forest` (crater clearing; use `F(x, y, z)`).
- **Moods** (second word): `day`, `dusk`, `night`, `red`, `nightred`, `green`.
  Override inside a shot with `setEnv(night, green, red)`.
- **Actors**: `A.zero`, `A.zeebra`, `A.luna`, `A.zip`, `A.mayor`, plus the film's cast; `crowd[0..13]`.
  `put(a, x, z, ry, clip, time, face, y = 0, size = 1)` or `a.place().pose(clipA, tA, clipB, weightB).face()`.
  `a.number(text, color, scale)` shows a badge above the head.
- **Clips**: Idle, Walk, Run, Talk, Wave, Shock (one-shot), Cheer, Sad, Point, LookUp, Sit, HandsUp,
  Reach, Shiver, Eat, Block. **Faces**: neutral, happy, shock, sad, smug, angry, sleep.
  Face options: `blush`, `lashes`, `mustache`, `brow`, `alien`. **Hair**: Zero, Zeebra, Luna, Zip, Zark, Mayor.
- **Clothing**: `fit: [...]` picks the pieces a character wears: sleeves `Short` or `Long` (cuffs),
  `Shorts`, neck `Crew` / `Collar` / `Scarf`, body `Hood` / `Jacket` / `Tie` / `Belt` / `Pack`, and `Skirt`.
  `cloth: { Shirt | Pants | Skirt: "stripes" | ["plaid", "#second"] }` prints a pattern (stripes, pinstripe,
  plaid, dots, checks, camo). Extra `col` keys: `Trim` (collar and cuffs), `Sleeve`, `Forearm`, `Shin`, `Belt`,
  `Sole`, `Inner`, `Skirt`, `Pack`; unset ones are derived from Shirt, Pants and Skin. A cast entry with no
  `fit` keeps plain long sleeves. Chest prints and faces are drawn in a 256 space (stored at 512).
- **Look**: every frame gets a warm key with shadows, a cool sky fill, a rim light behind the subject
  (placed from the camera), reflections from a studio sky, lamp pools and a bedside lamp at night, a sky
  with sun glow, moon and drifting clouds, then depth of field, bloom and the film grade (contrast curve,
  cool shadows / warm highlights, vignette, lens fringing, grain). `grade.uniforms` (`contrast`, `split`,
  `grain`, `fringe`, `sat`, `vig`), `sun`, `hemi`, `rim`, `fill` and `bloom` are exported for a film that
  needs its own look; set them inside the shot, after `setEnv`.
- **Textures**: set and prop materials are textured by glTF material name in `textures.js` (`SURFACES`).
  GLB meshes carry box-projected UVs in studs, so a new Blender material only needs a line there.
- **Camera**: `cam(t, fromPos, fromTarget, toPos, toTarget, ease(u), shake = 0, fov = 55)`.
  Focus, shadows and the night fill light follow the target. Eases: `smooth`, `easeOut`, `backOut`.
- **Crowd**: `crowdWalk(t, {count, behind, face})`, `crowdRun(t, d, {dir, z0, gap, speed, face})`,
  `crowdArc(t, clip, face)`; `WALK[i]` holds each walker's lane.
- **Props**: `setCar`, `setShip` + `shipBeam`, `setStone`, `setPancakes`, `smoke`, `sparkle`, `beam`,
  `books`, `greenStar`, `glow`; `board`, `houseWindow`, `roomWindow`, `windowTex`, `canvasTex`, `mats`.

## Lessons already paid for

- A shot that throws leaves the previous frame on screen. The engine now logs
  `shot "<id>" failed`; if a snapshot shows the wrong shot, look for that error first.
- Number badges, light cones and stars are drawn after post-processing; anything transparent in the
  main scene gets dark boxes from ambient occlusion.
- Bloom blows out white clothes at night. Keep point lights low (the stone uses 7) and prefer
  emissive materials for glow.
- Keep the camera out of buildings: house fronts are at |x| ≈ 21 on the street.
- Crowd members walk through marks; pass `behind: z` to keep the lens side of a hero clear.
- Light cones look bad from above or from inside; use them for a single beam seen from the side.
- Check the last frame before and the first frame after a cut when a prop appears at a cut.
- In Blender, build each primitive in its own bmesh and merge it (`Builder._merge`). Bevelling inside the
  shared mesh replaced faces and they fell back to the mesh's first material (white hands, dark shoe tops).
- The bedside lamp and the lamp pools add to a film's own lights; white hair and shirts clip first, so
  look at night close-ups in the room after changing light levels.
- Chest prints sit at y = −0.566 in front of the torso; clothing pieces must stay behind that.
