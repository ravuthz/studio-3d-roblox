# Style: pixar-disney

## The references

`top-k-ma-1.mp4` (66 s) and `top-k-ma-2.mp4` (300 s), 3840×2160, 30 fps, horizontal.
`v1/` and `v2/` hold contact sheets (`sheets/`, 1 frame per second, 20 per sheet) and one frame per cut (`keys/`).

What they show:

- **Characters**: two toddlers about 2.5 heads tall. Very large heads, huge glossy brown eyes with two
  highlights, tiny button noses, rosy cheeks, small mouths, chubby mitten-like hands.
- **Surfaces**: soft skin that light passes through, hair with strands, cloth with folds and weave.
- **Light and colour**: warm golden key from a window, pastel sets (mint, pink, cream, butter yellow),
  strong background blur.
- **Sets**: cosy and full of detail: bedroom, bathroom, kitchen, living room, garden, suburban street.
- **Film**: 2–3 word captions, slow pushes, one action per shot.

## What this project builds from it

The references cannot be matched by shapes built in code: the skin, hair strands, cloth folds and
facial animation need sculpted models and a film renderer. The engine builds a **toy-figure version** of the
look instead: the same proportions, eyes, palette and light, on smooth vinyl-figure shapes.

| Rule | Value |
| --- | --- |
| Height | about 5.1 studs, 2.3 heads tall |
| Head | cranium sphere plus two cheek spheres and a small chin; ears; a 3D button nose |
| Body | pear-shaped torso, short tapered limbs, mitten hands with a thumb, rounded shoes |
| Eyes | drawn on a decal that wraps the head: 72 px wide in a 256 px face, brown iris with a gradient, two highlights, lash line |
| Cheeks | always a soft pink glow; `blush` makes it stronger |
| Hair | a smooth cap plus soft overlapping locks; no strands |
| Skin | roughness 0.5 with a warm sheen at grazing angles |
| Light | warm key, soft shadows, light fill; pastel backgrounds |

## Files

Everything for this style is in `core/styles/pixar-disney/` (see "Styles" in `AGENTS.md`):

- `build.py` → `assets/character.glb`, `town.glb`, `sets.glb`. Every character shape is a convex hull of a
  few spheres. Same bones, clip names, material and object names as the roblox style.
- `style.js`: the seven faces, the model size, the skin material and the light.
- `core/styles/preview.html?style=pixar-disney`: turnaround and faces; `&sheet=poses` shows the clips.
- `toy/zero-turnaround.png`, `toy/zero-poses.png` here: the first Zero, before the style had its own
  town and animations.

A film uses it with `"style": "pixar-disney"` in `story.json`. Test film: `outputs/warm-hugs`.

## Not done yet

- The bedroom, forest, car and family house are the roblox ones with round edges and pastel colours.
- Props and effects (sparkles, smoke, spaceship, badges) are shared with the roblox style.
- Hugging characters put their heads through each other.
