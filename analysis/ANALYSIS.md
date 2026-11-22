# Reference analysis: ten "In this town…" blocky 3D story shorts

Source: ten vertical shorts (576×1024, 30 fps, 108–148 s each) in `/Users/ravuthz/Projects/@data/3d-robox-shorts`.
Method: `preprocess.py` (audio, Whisper word timestamps, scene cuts, loudness, 1 fps frames) and `sheets.py`
(2 fps timestamped contact sheets), then five Opus 5.5 analysts read every contact sheet, two videos each.
Per-video data lives in `styles/roblox/vNN/` (`meta.json`, `transcript.txt`, `transcript.json`, `frames/`, `sheets/`),
next to the two scripts and `index.json`. The story template below applies to every film style.

## The ten videos

| id | premise | length | words/min | shots (manual) | avg shot | ending |
|---|---|---|---|---|---|---|
| v01 | everyone has a bunker except the narrator | 124 s | 149 | ~78 | 1.6 s | cliffhanger |
| v02 | the richer you are, the higher your house | 120 s | 167 | ~70 | 1.7 s | cliffhanger |
| v03 | same, part 2 | 131 s | 170 | ~69 | 1.9 s | resolved, ironic reversal |
| v04 | touching the ground costs $10 | 145 s | 158 | ~72 | 2.0 s | new-rule twist |
| v05 | everyone must choose between two pills | 125 s | 165 | ~68 | 1.8 s | countdown + vote prompt |
| v06 | you get paid for being unlucky | 145 s | 170 | ~75 | 2.0 s | resolved payoff |
| v07 | the ice cream truck only comes at night | 148 s | 162 | ~73 | 2.0 s | note cliffhanger |
| v08 | everyone watches these videos (course promo) | 108 s | 175 | ~54 | 2.0 s | call to action |
| v09 | the monster only moves in the dark | 132 s | 164 | ~63 | 2.1 s | cliffhanger |
| v10 | same, part 2 | 139 s | 160 | ~66 | 2.1 s | resolved |

## Story structure (shared template)

1. **Hook, 0–4 s**: one sentence stating a strange town rule, usually starting "In this town".
2. **Rule explained with a list, 4–30 s**: three or four escalating examples, one shot (often one mini-set) per item.
   Lists are counted or tiered: numbered bunkers, floor heights, prices, rules 1-2-3.
3. **Protagonist intro, 4–35 s**: "My name is …" on a frontal medium shot; he is the exception to the rule ("but me?").
4. **Status quo and humiliation**: why the rule hurts him; a friend or family member who benefits.
5. **Turn, around 40–60 %**: "until", "but everything changed", "then I noticed something strange".
6. **Discovery and escalation**: a hidden place (control room, vault, tower) and diegetic screens that deliver information.
7. **First twist at 60–80 %**, **main twist near 85–90 %**: the rule exists for a hidden reason tied to the hero.
8. **Ending in the last 5–10 s**: cliffhanger line, a second rule, or an ironic reversal that echoes the opening line.
   Sequels re-state the opening line over the same establishing shot, recap in about 10 s and resolve the cliffhanger by 20 %.

Narration is first person, mostly past tense, 150–175 words per minute, 6–8 word clauses, with 0.4–0.7 s pauses before reveals.
Hinge words carry the structure: "but", "until", "suddenly", "that's when", "then".

## Picture

- **Characters**: blocky six-part avatars (head, torso, two arms, two legs, no elbows or knees), bevelled edges,
  flat 2D face decals. Acting is expression swaps at cuts (neutral, smile, smirk, sad, angry, round-eyed shock,
  sweat drop). No lip sync. One signature outfit colour per hero. Crowds are 5–30 recoloured clones with offset loops,
  occasionally hundreds via instancing.
- **Animation vocabulary**: idle, walk, run, wave, talk gesture, point, shock, cheer, sit, sleep, look up, hold or
  press a prop, plus one or two bespoke actions per episode (climb, fall, fly, grab).
- **Sets**: 7–15 per episode. A modular street kit (pastel facades, awnings, lamps, trees) carries 40–60 % of screen
  time; the rest are small one-off rooms and one "secret" location with screens.
- **Camera**: wide lens, many low angles. 30–55 % of shots are slow push-ins, the rest near-static with drift,
  plus cranes and tilts for scale. Hard cuts only; rare white flashes and foreground wipes.
- **Shot mix**: about 35–45 % wide, 25–35 % medium, 15–25 % close-up, 8–15 % inserts and screens.
- **Rhythm**: a cut every 1.6–2.1 s, landing within about 0.3 s of a narration phrase start. Fast passages
  (0.4–1 s shots) for countdowns and reveals; the longest shots are 3–4 s scale reveals.
- **Look**: path-traced-style soft global illumination, ambient occlusion, soft shadows, bloom on emissives,
  shallow depth of field on close-ups, haze outdoors. Grade presets per act: warm dusk or pastel day, blue night,
  red or neon "alarm".
- **Captions**: one word at a time from word timestamps; heavy rounded sans; lime-yellow (about `#E8FF3A`) with a
  black stroke and soft shadow; centred at 64–72 % of frame height; pop from about 30 % scale in 0.1 s;
  emphasis words 1.3–1.5× larger; lowercase except names; no emoji.
- **Other text is in-world**: screens, signs, phone UI, countdowns and floating number or money badges.

## Sound

Loudness sits between -14 and -20 LUFS integrated with a narrow 2.5–5 LU range (heavily compressed voice-over).
The transcripts and levels were measured; music and effects were not separated, so their description here is limited
to what the cuts imply (hits on reveals, whooshes on cuts).

## What matters most for a code-driven remake

1. Word-synced one-word captions with the exact style above.
2. A cut on every phrase with a slow push on every shot, driven by the voice-over timestamps.
3. One blocky rig, a face-decal library and a small clip library reused everywhere.
4. A modular set kit with day, night and alarm lighting presets.
5. In-world screens and badges generated as textures.

Hardest to do procedurally: the number of one-off sets and hero props per episode, physical gags
(falls, crashes, splashes), believable crowds, and matching path-traced lighting in real time.
