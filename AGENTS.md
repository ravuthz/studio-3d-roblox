# 3D blocky story films

Code-driven vertical story shorts (9:16, 1080×1920, 30 fps, **62–75 seconds by default**):
blocky characters, one-word captions, a cut on every phrase, first-person narration.
Films belong to a **series** (`core/series/<id>.json`): each has its own cast, narrator, story
format and topic list. Series today: `family` (Dad Bo, Mom Mira, kid Pip narrating, dog Biscuit)
and `lover` (Kai and Nova, Nova narrating). Blender builds the assets, VoxCPM2 (through the `/my-editor` skill) speaks the narration
in a cloned voice from `voices/`, Three.js stages every shot, HyperFrames composites and renders the MP4.

## Defaults for every film

- **Format**: 9:16 vertical, 1080×1920, 30 fps.
- **Length**: 62–75 seconds of narration plus the tail (never under 61 s: TikTok only monetizes videos over a minute), unless the user asks for another length.
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
  assets/                   character.glb, dog.glb, town.glb, sets.glb
  series/<id>.json          one file per series: cast, narrator, format, caption names, topics
  engine/stage.js           renderer, lights, film grade, cast and clothing, crowd, props, cameras, createFilm()
  engine/kit.js             scene kit: room shells, palettes, mood lights, prop library (see "Scene kit")
  scenes/<id>.json          kit scenes (park, school, mall): plain JSON layouts, no code
  engine/textures.js        procedural surface textures (brick, asphalt, wood, fabric…) and printed cloth
  engine/captions.js        one-word captions and flashes from the word timings
  scripts/                  film.mjs (CLI), series.mjs (series loader), scenes.mjs (kit scene list for prompts), narrate.py, tts.mjs (legacy), plan.mjs, audio.py
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
studio/               Film Studio web app (Vite + React + shadcn/ui, light and dark mode): browse films,
                      read scripts, review snapshots, play renders and run pipeline steps with live logs
analysis/             notes and scripts from studying ten reference shorts (ANALYSIS.md)
voices/               narration references for /my-editor: in-town.mp3 (English), ravuthz.mp3 (Khmer)
.agents/skills/       project skills for every agent (my-editor); .claude/skills is a symlink to it
CLAUDE.md, GEMINI.md  both just import this file
elevenlabs.js         ElevenLabs client (legacy narration); key and ELEVENLABS_VOICE_ID come from .env.local
```

`outputs/` is git-ignored, so film sources are not versioned unless that rule is changed.

## Rules for new films

1. Every new film is a new folder in `outputs/`, created with `npm run film -- new <name> "Title" --series <id>`.
   Never copy the engine, vendor files, scripts or GLB assets into a film.
2. A film extends the core: it imports from `core/stage.js` and calls `createFilm({...})`.
   Film-only characters, textures and helper functions live in that film's `film.js`.
3. If something would be useful to a second film (a clip, a prop, a set, a helper, a face style),
   add it to `core/` and export it, then use it from the film. Check the other films still render.
4. Films are original stories. The reference shorts are for format and pacing only; do not reuse
   their scripts, characters or shots.
5. Every film belongs to one series and uses only that series' cast and format (`"series"` in
   story.json; see "Series" below). The old family (Zero, Zeebra, Luna, Zip) stays in the engine only
   so older films still load; new films do not use it.
6. Never read, print or commit `.env.local`. The voice step reads the key itself.
7. Narration always uses the `/my-editor` voice clone for the film's language (English:
   `voices/in-town.mp3`, Khmer: `voices/ravuthz.mp3`). Never overwrite or edit files in `voices/`.
8. A new film is 9:16 and 62–75 seconds long unless the user asks otherwise.

## Commands

```bash
npm run film -- new <name> "Title" --series family|lover   # scaffold outputs/<name>/ (default series: family)
npm run film narrate <name>       # /my-editor voice-clone narration + word timings (cached per line)
npm run film voice <name>         # LEGACY ElevenLabs narration for older films
npm run film plan <name>          # cut times, sound events, durations
npm run film audio <name>         # synthesised music and effects (needs python with numpy)
npm run film check <name>         # HyperFrames lint
npm run film shots <name> [ids]   # snapshot the middle frame of every shot, or of the listed cut ids
npm run film render <name>        # outputs/<name>/renders/<name>.mp4
npm run film build <name>         # narrate (voice for films without "lang") → plan → audio → check → render
npm run film assets               # rebuild core/assets with Blender (after editing build_assets.py)
npm run auto -- [--series family|lover] [--count N] [--agent claude] [--model id] [--lang en|km] [--parallel N]   # autopilot: next topic → agent writes story + shots → build → MP4, no confirmation (--count 0 = until Ctrl+C)
npm run studio                    # Film Studio web app on http://127.0.0.1:3100 (run `npm install` in studio/ once)
```

The studio only calls `core/scripts/film.mjs`; it adds no pipeline logic of its own. Its API is
`studio/server/api.mjs` (served by Vite in dev, by `studio/server/serve.mjs` after `npm run build`).
It binds to 127.0.0.1 and serves only `renders/`, `assets/audio/` and snapshot folders of a film.
UI components come from shadcn: add more with `npx shadcn@latest add <name>` inside `studio/`.
"New film" in the studio can hand the new folder to an AI agent (`STUDIO_AGENTS`, default
`agy,codex,claude`, set in `studio/.env`) that writes `story.json` and `film.js` only.
"Autopilot to video" in that dialog (or `npm run auto`) does the whole chain unattended: it picks the
next unused topic for the chosen series (the agent, else the series' `topics`), scaffolds the film,
lets the agent write it, then runs `build`. It skips the snapshot review, so check the render afterwards.
Up to `--parallel` agents (default 3, max 6) write films at the same time; builds run one at a time
because the render already fills the CPU. It starts no new films after three failures in a row; the sidebar shows progress and a stop button.

Preview in the browser: the `film-preview` entry in `.claude/launch.json` serves one film on
port 3002; change its `outputs/<name>` argument to preview another film.

## Making a film, step by step

1. **Script** in `story/story.json`: 62–75 seconds by default. For English, about 2.65 words per second including pauses
   (≈175–200 words); for Khmer, time a test line with the clone and size the script to fit. Follow the
   series' `format.shape` (core/series/<id>.json); pacing notes are in `analysis/ANALYSIS.md`.
2. **Cuts**: each line starts a shot; add `cuts` words so the average shot is 1.6–2.1 s.
3. `narrate` (next section), then `plan`. Read the printed shot count and
   average length, and check the narration lands between 62 and 75 seconds (plan warns under 61 s).
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

Top level: `title`, `series` (series id), `names` (words captions keep capitalised), `voice` (model, speed, stability,
similarity, style), optional `voiceId`. A `tail` shot is added automatically after the narration.
Add `"lang": "en"` or `"lang": "km"` to pick the narration voice (English is the default).

## Narration with /my-editor

`npm run film narrate <name>` (`core/scripts/narrate.py`) runs the `/my-editor` voice-clone
workflow for the whole film:

- **Skill copy**: the project carries its own copy of the skill in `.agents/skills/my-editor/`
  (SKILL.md, `scripts/tts.py`, `sfx.py`, transcription scripts; no voice files — it reads `./voices/`).
  Codex, Antigravity (`agy`), Gemini CLI and OpenCode read `.agents/skills/`; Claude Code reads it
  through the `.claude/skills` symlink. Put new project skills in `.agents/skills/`, never in
  `.claude/skills/` directly. `narrate.py` uses this copy; set `MY_EDITOR=<dir>` to use another one.

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

## Series

One JSON file per series in `core/series/<id>.json`. `film new --series`, the studio's New film
dialog (one Series select), Auto topic, autopilot and the agent prompt all read it.

```jsonc
{
  "id": "family",                       // file name, lowercase-dashes; films store it as "series"
  "label": "Family",                    // shown in the studio
  "narrator": { "key": "pip", "name": "Pip", "role": "kid, first-person narrator" },
  "cast": [                             // key = actor in core/stage.js (A.<key>)
    { "key": "bo", "name": "Bo", "role": "dad" },
    { "key": "biscuit", "name": "Biscuit", "role": "family dog", "dog": true }   // dog: uses the dog API
  ],
  "names": ["Bo", "Mira", "Pip", "Biscuit"],   // caption words kept capitalised; copied into story.json
  "format": { "label": "family skit", "shape": "Story shape text the writing agent follows…" },
  "topics": [ { "name": "folder-slug", "title": "Title", "idea": "2–3 sentence idea" } ]
}
```

A new series is a new file plus actor entries for its cast in `core/engine/stage.js` (`CAST`, or
`DOGS` for a dog). Nothing else needs changing.

## Scene kit (new places without engine code)

A kit scene is one JSON file, `core/scenes/<id>.json`, built at load by `core/engine/kit.js` from a room shell,
a palette, a mood-light preset and props from the library. A film uses it like any set: the env string is
`"<id> day"` (or `dusk`, `night`, any mood). Only scenes a film names are fetched and built, so other films are
untouched. `home` and `cafe` stay hand-built in `stage.js`: rebuilding them from kit props without a visible change
was not practical, and the kit props `sofa`, `armchair`, `coffeeTable`, `floorLamp`, `diningTable`, `chair`,
`counter`, `fridge`, `twoTop`, `bistroTable`, `bistroChair`, `stool`, `cafeCounter`, `pendant`, `stringLights` are
copies of their furniture.

**Scenes today**

| id       | Series         | Cameras (`S.cam.*`)                                                   | Seats                               | Marks |
| -------- | -------------- | --------------------------------------------------------------------- | ----------------------------------- | ----- |
| `park`   | lover          | wide, bench, benchL, benchR, path, walk, lights, fountain             | benchL, benchR (behind a hedge), sideL, sideR | path, pathL, pathR, walkL, walkR, fountain, lane |
| `school` | family (Pip)   | wide, board, teacher, pip (reverse, Pip's face), class (reverse, all desks), window, door | pip, deskA–deskH (face the board), teacher | board, teacher, front, aisle, door, lockers |
| `mall`   | family, lover  | wide, bench, benchL, benchR, shops, escalator, kiosk, upper           | benchL, benchR (behind a planter)   | toys, books, shoes, kiosk, kioskFront, benchFront, walk |

School desks face the board (−Z), so student faces need the reverse cameras (`pip`, `class`) that stand near the
board and look toward +Z; the desk front panels hide their legs from there.

**In film.js** (same shape as `HM` / `shotCam` / `sitIn`):

```js
import { useScene, shotCam, frameOn, sitIn, A } from "core/stage.js";
const PARK = useScene("park");                       // call at the top; filled in when the layout loads
["bench", "park dusk", (t, u) => {
  PARK.sit(A.kai, "benchL", "Sit", t, "happy");       // = sitIn(A.kai, PARK.at, PARK.seats.benchL, …)
  PARK.put(A.nova, "pathR", "Wave", t, "happy");      // stand on a named mark, or pass [x, z, ryDegrees]
  PARK.shot(t, u, "bench");                           // = shotCam(t, u, PARK.cam.bench, opts)
  // PARK.frame(t, u, x, z, eyeY, dist, opts) = frameOn(t, u, PARK.at, …);  PARK.at(x, y, z) → world
}],
```

`S.put` / `S.sit` take the usual options (`dx`, `dz`, `ry`, `size`, `clipB`, `wb`). Use only `S.*` inside shots;
the layout is not loaded when film.js first runs.

**Layout schema** (all coordinates in studs, scene-local; angles in degrees; the open side faces +Z, so cameras
stand at larger z and look toward −Z):

```jsonc
{
  "id": "park", "label": "City park", "series": ["lover"],      // series: who it is offered to in prompts
  "about": "one line for the writing agent",
  "shell": {
    "kind": "room",                       // or "outdoor"
    "x": [-24, 24], "z": [-18, 26],       // floor area; room walls stand on these edges
    "height": 16,                         // room only
    "walls": { "back": "wall", "left": "wall2", "right": "wall2", "front": "wall" },   // palette key or false
    "ceiling": true, "beams": false, "wainscot": "wall2",           // optional lower band in another colour
    "openings": [                         // "at" runs along the wall (x on back/front, z on left/right)
      { "wall": "left", "type": "window", "at": -6, "y": 8.5, "w": 10, "h": 7, "view": "garden", "curtains": "accent" },
      { "wall": "right", "type": "door", "at": 17, "w": 5, "h": 9.5 }   // door | glassdoor | doorway
    ],
    "horizon": ["trees", "city", "hills"] // outdoor only: far scenery around the ground
  },
  "palette": "school",                    // or { "base": "school", "wall": ["plaster", "#f3e7c9"], "accent": "#e76f51" }
  "light": "indoor",                      // indoor (night ceiling fill, default for rooms) | outdoor
  "lamps": [{ "x": 0, "y": 9, "z": -6, "day": 2, "night": 10, "dist": 40 }],   // extra warm lights (max 6 lights per scene)
  "props": [
    { "prop": "bench", "x": 0, "z": -11, "ry": 0, "scale": 1, "color": "woodL", "cover": "hedge", "seats": ["benchL", "benchR"] }
  ],
  "seats": { "stool": [4, 3.25, -9, 0] }, // extra seats by hand: [x, y, z, ryDeg]
  "marks": { "path": [0, -3, 0] },        // standing marks: [x, z, ryDeg] (0 = facing the cameras)
  "cams": { "bench": { "from": [0, 7.2, 7], "to": [0, 4.2, -10.8], "end": [0, 7, 5], "fov": 46 } }
}
```

A prop entry is `{ prop, x, z, y?, ry?, scale?, color?, color2?, seats?, ...options }`. `color` / `color2` take a
palette key, `"#hex"` or `[surface, "#hex"]`. `seats` names the prop's seat slots in order (left to right as the
camera sees it at `ry` 0). A camera with no `end` pushes in 12% toward `to`.

**Palettes**: `home`, `cafe`, `park`, `school`, `mall`, with keys `floor wall wall2 ceiling trim wood woodL fabric
fabric2 accent accent2 metal dark leaf pot rug ground path board glass lamp`. Surfaces: `planks plaster brick grain
tiles checker carpet fabric leaves grass pavers asphalt stone rock siding shingles polish metal` (materials
`Kit<Surface>` in `textures.js`). Mood: the global day/dusk/night look, window backdrops (garden, street) switch
with it, and lamp/string-light/sign/storefront glows come up at dusk and night.

**Prop library** (`KIT_PROPS`; options in brackets; all face +Z, so wall props go against the back wall unrotated):

- Living: `sofa` (3 seats), `armchair` (1 seat), `coffeeTable`, `floorLamp` [light], `tv` [text], `bookshelf` [w],
  `rug` [w, d], `plant` [size, tall], `diningTable` (4 seats, chairs included) [chairs], `chair` (1 seat),
  `counter` (kitchen run) [len, sink, stove], `fridge`
- Cafe: `twoTop` (2 seats behind a front panel: legs hidden), `bistroTable` [r, cup], `bistroChair` (1), `stool` (1),
  `cafeCounter` [len], `pendant` [bulb, light], `stringLights` [len, h, sag, poles]
- Wall and signs: `art` [w, h, style 0–3], `sign` [w, h, text, glow], `poster` [w, h, text], `clock`,
  `chalkboard` [w, h, text with \n], `box` [w, h, d] (any filler block)
- Outdoor: `tree` [size], `pine` [size], `bush` [size], `hedge` [len, h], `flowerBed` [len, colors],
  `bench` (2 seats) [len, cover: "hedge" | "planter"], `picnicTable`, `lampPost` [h, light], `path` [w, len],
  `fountain` [r], `fence` [len], `trashCan`
- School: `desk` (1 seat behind a front panel) [chair, book, chairColor], `teacherDesk` (1 seat), `lockers` [n]
- Mall: `storefront` [w, h, text, textColor, awning], `escalator` [run, rise, w], `planter` [len, h], `column` [h, w],
  `kiosk` [text], `balcony` [len, h, d], `ceilingLight` [w, d]

**Add a scene with only a JSON file** (no engine code; a cheap model can do this):

1. Copy the closest file in `core/scenes/` to `core/scenes/<new-id>.json` and change `id`, `label`, `about`, `series`.
2. Set the shell and palette, then list props from the library above. Seat people only in seats that have cover in
   front (`twoTop`, `desk`, `teacherDesk`, `bench` with `cover`, or a table/planter you place between seat and lens).
3. Add marks and 4–8 cameras. Keep the framing distances below: adult mid shot 11–13 studs, two people 15–17.
4. Test it in a throwaway film (env `"<new-id> day"`, `useScene("<new-id>")`) with `npm run film shots <film>` and
   read the contact sheets. `outputs/scene-test` is a working example with a hand-written timing file.

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
  along Z with the tower at z ≈ −72; the narrator's mark is `(0, 8)`. Cameras looking toward −Z see faces.
- **Sets** (first word of the env string): `town`, `house` (town + the family house at z = 64, facing −Z),
  `room` (the kid's bedroom; use `R(x, y, z)`), `forest` (crater clearing; use `F(x, y, z)`),
  `highway` (open canyon highway with scrolling roadside scenery and cantilever sign; use `HW(x, y, z)` and `setHighway(t, {speed, signZ, signTex, showSign})`).
  `home` (family series: open-plan living room + kitchen, use `HM(x, y, z)`): sofa under a big garden window, coffee
  table, armchair, floor lamp, TV on the left wall (`setHomeTv(tvTex(draw))`), bookshelf, Biscuit's dog bed at (−1.5, −2)
  with bowl and bone, kitchen counter, stove, sink window, fridge, dining table at (12.5, −6.5) with four chairs and
  pendant lamps. Seats in `HOME_SEATS` (`sofaL/C/R`, `chairL/R`, `chairEndL/R`, `bed`) for `sitIn(actor, HM, slot, clip, t, face)`;
  the pancake plate sits well at `HM(12.5, 3.1, -6.5)`.
  `cafe` (lover series, use `CF(x, y, z)`): brick back wall with a big street window and the pin sill at (−9.5, −17.3),
  the couple's two-top at (−7, −1.6) with seats `CAFE_SEATS.left/right` (they sit side by side facing the room, the
  table's front panel hides their legs), counter with espresso machine, pastry stand, stools and a menu board
  (`setCafeMenu(menuTex(draw))`), banquette under the left window, string lights and pendants.
  Kit scenes (`park`, `school`, `mall`, and any `core/scenes/<id>.json`) are sets too; see "Scene kit".
  Home and cafe are open toward +Z like a stage: cameras stand in the room at z > 0 and look toward −Z. Moods work as usual;
  the window backdrops switch day / dusk / night and the practical lamps come up at night.
  **Cameras**: `CAM_HOME` (`wide`, `living`, `sofa`, `kitchen`, `table`, `dogbed`, `window`) and `CAM_CAFE` (`wide`,
  `table`, `left`, `right`, `counter`, `menu`, `window`) are tested slow pushes: `shotCam(t, u, CAM_HOME.wide, {aim, move, fov, ease, shake})`.
  For anyone else use `frameOn(t, u, HM, x, z, eyeY, dist, {yaw, lift, fov})`. The 9:16 frame is narrow (about
  0.45 × distance wide at fov 46), so stand back: adult mid shot 11–13 studs, two people 15–17, punchline close-up 8,
  Biscuit 10–12 at target y ≈ 1.8. Keep close-ups for punchlines.
- **Moods** (second word): `day`, `dusk`, `night`, `red`, `nightred`, `green`.
  Override inside a shot with `setEnv(night, green, red)`.
- **Actors**: series casts `A.bo`, `A.mira`, `A.pip`, `A.biscuit` (dog), `A.kai`, `A.nova`; the old family
  `A.zero`, `A.zeebra`, `A.luna`, `A.zip`; `A.mayor`; plus the film's cast; `crowd[0..13]`.
  `put(a, x, z, ry, clip, time, face, y = 0, size = 1)` or `a.place().pose(clipA, tA, clipB, weightB).face()`.
  `a.number(text, color, scale)` shows a badge above the head.
- **Clips**: Idle, Walk, Run, Talk, Wave, Shock (one-shot), Cheer, Sad, Point, LookUp, Sit, HandsUp,
  Reach, Shiver, Eat, Block. **Faces**: neutral, happy, shock, sad, smug, angry, sleep.
  Face options: `blush`, `lashes`, `mustache`, `brow`, `alien`, `shade` (glowing eyes for a dark shadow person; a string sets the eye colour). **Hair**: Zero, Zeebra, Luna, Zip, Zark, Mayor (see "Restyling characters").
- **Dog** (`A.biscuit`, from `core/assets/dog.glb`, its own 7-bone rig): same API as people —
  `put(A.biscuit, x, z, ry, clip, t, face, y, size)` or `A.biscuit.place(x, z, ry).pose(clipA, tA, clipB, wB).face(f)`,
  plus `number()`. About 3 studs tall at the head, 4 long, faces +Z at `ry = 0`; frame it with a low camera
  (target y ≈ 1.6–2.2). **Dog clips**: Idle, Walk, Run, Sit, Bark, Beg, Sleep (all loop; `DOG_CLIPS`).
  **Dog faces**: neutral, happy (tongue out), sad, shock, sleep (`DOG_FACES`; `smug` → happy, `angry` → shock).
  Human clips do not exist on the dog and throw. A film can add dogs with `createFilm({ dogs: { name: {...} } })`.
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
- **Props**: `setCar`, `setRoadCar` + `seatInCar` + `setStereo` (`stereoTex`, `highwaySignTex`; open-window 4-seat family SUV cabin with dashboard stereo, steering wheel, roof luggage and `ROAD_SEATS`: `driver`, `passenger`, `backL`, `backR`, `backC`, `lean`), `setShip` + `shipBeam`, `setStone`, `setPancakes`, `smoke`, `sparkle`, `beam`,
  `books`, `greenStar`, `glow`; `board`, `roadCar`, `stereo`, `highwaySign`, `houseWindow`, `roomWindow`, `windowTex`, `canvasTex`, `mats`.

## Restyling characters

Series characters currently wear PLACEHOLDER looks (existing hair and fits).

- **People** (`bo`, `mira`, `pip`, `kai`, `nova`): edit their entries in `CAST` in `core/engine/stage.js`
  (search `series casts`). Fields: `hair` (style name), `scale` (height; the kid ≈ 0.84, adults 1.0–1.12),
  `face` options, `fit` clothing pieces, `cloth` patterns, `col` colours (Skin, Shirt, Pants, Shoes, Hair,
  HairStreak, Acc, Trim, …), `chest` print (add a drawing to `CHESTS` for a new one). No rebuild needed.
- **The dog**: edit `DOGS.biscuit` in `core/engine/stage.js`: `scale`, `ears` (`Floppy` | `Pointy`),
  `col` (Fur, Patch = ears and tail tip, Paw = paws, snout and belly, Nose, Collar, Tag) and `face`
  (`eye`, `brow`, `tongue` colours). Body shape and new ear styles are in `build_dog()` in
  `core/blender/build_assets.py` (`EAR STYLES`), then `npm run film assets`.
- **New hair style** (only `core/blender/build_assets.py`, no pipeline code):
  1. In `build_character()`, write `def hair_<name>(b):` next to the other hair functions, out of
     `b.box(size, center, material, bevel, segments, rot_z=, rot_x=, rot_y=)` and `b.blob(radius, center, material, scale)`.
     Blender coordinates: z is up, the face looks toward −y; the head box spans x and y −0.65…0.65 and
     z 4.03…5.23. Materials: `hair` (col.Hair), `hair2` (col.HairStreak), `acc` (col.Acc).
  2. Add it to `HAIR_STYLES` (`"Name": hair_name`).
  3. `npm run film assets`, then set `hair: "Name"` on the cast entry. The mesh is `M_Hair_<Name>`;
     names match exactly.
  4. Check a close-up with `npm run film shots <film> <ids>` and confirm other films still look right.

## Lessons already paid for

- A shot that throws leaves the previous frame on screen. The engine now logs
  `shot "<id>" failed`; if a snapshot shows the wrong shot, look for that error first.
- Number badges, light cones and stars are drawn after post-processing; anything transparent in the
  main scene gets dark boxes from ambient occlusion.
- Bloom blows out white clothes at night. Keep point lights low (the stone uses 7) and prefer
  emissive materials for glow.
- Keep the camera out of buildings: house fronts are at |x| ≈ 21 on the street.
- Cameras 5–6 studs from a face look cramped in 9:16. Start from the `CAM_HOME` / `CAM_CAFE` presets or the
  `frameOn` distances above, and check each shot clears the furniture between lens and actor.
- Seated people on open chairs show floating legs (the Sit clip stretches them forward). Put a table or a car
  door between them and the lens, as the cafe two-top and the road car do.
- Crowd members walk through marks; pass `behind: z` to keep the lens side of a hero clear.
- Light cones look bad from above or from inside; use them for a single beam seen from the side.
- Check the last frame before and the first frame after a cut when a prop appears at a cut.
- In Blender, build each primitive in its own bmesh and merge it (`Builder._merge`). Bevelling inside the
  shared mesh replaced faces and they fell back to the mesh's first material (white hands, dark shoe tops).
- The bedside lamp and the lamp pools add to a film's own lights; white hair and shirts clip first, so
  look at night close-ups in the room after changing light levels.
- Chest prints sit at y = −0.566 in front of the torso; clothing pieces must stay behind that.
