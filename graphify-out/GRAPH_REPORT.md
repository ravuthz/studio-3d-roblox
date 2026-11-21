# Graph Report - 3d-roblox-pro  (2026-11-21)

## Corpus Check
- 110 files · ~45,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1201 nodes · 2378 edges · 74 communities (58 shown, 16 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 79 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Studio Sidebar UI
- Stage & 3D Scene Engine (1)
- GSAP Animation Core (2)
- Gemini Audio Transcription (3)
- Sound FX & Audio Synthesis
- Shadcn UI Components (5)
- Shadcn UI Components (6)
- Three.js GLTF Loader (7)
- Studio Backend API (8)
- Three.js GLTF Loader (9)
- Three.js GLTF Loader (10)
- Three.js GLTF Loader (11)
- Studio Config & Dependencies (12)
- Studio Config & Dependencies (13)
- Components Module
- GSAP Animation Core (15)
- Studio Config & Dependencies (16)
- Post-Processing Shaders (17)
- Project Manifest & Scripts
- Studio Config & Dependencies (19)
- Khmer Language Utilities
- TTS & Voice Narration (21)
- Status Module
- Blender Asset Pipeline (23)
- Procedural Textures
- TTS & Voice Narration (25)
- Blender Asset Pipeline (26)
- Post-Processing Shaders (27)
- Buffergeometryutils Module
- Post-Processing Shaders (29)
- Studio Backend API (30)
- Blender Asset Pipeline (31)
- Narrate Module
- Film CLI & Planning (33)
- Film CLI & Planning (34)
- GSAP Animation Core (35)
- Post-Processing Shaders (36)
- Studio Config & Dependencies (37)
- Stage & 3D Scene Engine (38)
- Three.js GLTF Loader (39)
- Post-Processing Shaders (40)
- Studio Config & Dependencies (41)
- Shadcn UI Components (42)
- Transcribe Module
- Blender Asset Pipeline (44)
- Gemini Audio Transcription (45)
- Three.js GLTF Loader (46)
- Post-Processing Shaders (47)
- Simplexnoise Module
- Hyperframes Module
- Skeletonutils Module
- GSAP Animation Core (51)
- Post-Processing Shaders (52)
- Serve Module
- Stage & 3D Scene Engine (54)
- Stage & 3D Scene Engine (55)
- GSAP Animation Core (56)
- Three.js GLTF Loader (57)
- Three.js GLTF Loader (58)
- Studio Config & Dependencies (59)
- Studio Config & Dependencies (60)
- Gemini Audio Transcription (61)
- Stage & 3D Scene Engine (62)
- GSAP Animation Core (63)
- GSAP Animation Core (64)
- GSAP Animation Core (65)
- GSAP Animation Core (66)
- Studio Config & Dependencies (67)
- Three.js GLTF Loader (68)
- Three.js GLTF Loader (69)
- Three.js GLTF Loader (70)
- Film Module
- Stage & 3D Scene Engine (72)

## God Nodes (most connected - your core abstractions)
1. `GLTFParser` - 36 edges
2. `react` - 29 edges
3. `NewFilmDialog()` - 25 edges
4. `FilmPage()` - 25 edges
5. `build_character()` - 22 edges
6. `compilerOptions` - 22 edges
7. `Pass` - 20 edges
8. `Button()` - 20 edges
9. `cn` - 20 edges
10. `AppSidebar()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `filmApi()` --calls--> `handler()`  [EXTRACTED]
  studio/vite.config.ts → studio/server/api.mjs
- `UnrealBloomPass` --inherits--> `Pass`  [EXTRACTED]
  core/vendor/three/addons/postprocessing/UnrealBloomPass.js → core/vendor/three/addons/postprocessing/Pass.js
- `BokehPass` --inherits--> `Pass`  [EXTRACTED]
  core/vendor/three/addons/postprocessing/BokehPass.js → core/vendor/three/addons/postprocessing/Pass.js
- `GTAOPass` --inherits--> `Pass`  [EXTRACTED]
  core/vendor/three/addons/postprocessing/GTAOPass.js → core/vendor/three/addons/postprocessing/Pass.js
- `OutputPass` --inherits--> `Pass`  [EXTRACTED]
  core/vendor/three/addons/postprocessing/OutputPass.js → core/vendor/three/addons/postprocessing/Pass.js

## Import Cycles
- None detected.

## Communities (74 total, 16 thin omitted)

### Community 0 - "Studio Sidebar UI"
Cohesion: 0.05
Nodes (55): lucide-react, next-themes, react-dom, sonner, App(), AppSidebar(), ModeToggle(), DropdownMenu() (+47 more)

### Community 1 - "Stage & 3D Scene Engine (1)"
Cohesion: 0.03
Nodes (63): A, beams, bloom, bokeh, books, _c, camera, canvas (+55 more)

### Community 2 - "GSAP Animation Core (2)"
Cohesion: 0.07
Nodes (15): Gc(), Hc(), ia(), ja(), Lc(), Nc(), oa(), pa() (+7 more)

### Community 3 - "Gemini Audio Transcription (3)"
Cohesion: 0.10
Nodes (12): estimate_segments(), get_duration(), get_error_status(), is_retryable_error(), load_gemini_keys(), normalize_audio(), parse_json_segments(), require_ffmpeg() (+4 more)

### Community 4 - "Sound FX & Audio Synthesis"
Cohesion: 0.16
Nodes (24): beep(), click(), ding(), _fade(), _filter(), impact(), laser(), _norm() (+16 more)

### Community 5 - "Shadcn UI Components (5)"
Cohesion: 0.15
Nodes (27): ConfirmRun(), NewFilmDialog(), submit(), Optional(), Button(), Dialog(), DialogClose(), DialogContent() (+19 more)

### Community 6 - "Shadcn UI Components (6)"
Cohesion: 0.16
Nodes (25): FilmPage(), LineText(), Runs(), Script(), Shots(), JobBadge(), MoodBadge(), Alert() (+17 more)

### Community 7 - "Three.js GLTF Loader (7)"
Cohesion: 0.16
Nodes (5): addUnknownExtensionsToUserData(), assignExtrasToUserData(), createDefaultMaterial(), GLTFParser, updateMorphTargets()

### Community 8 - "Studio Backend API (8)"
Cohesion: 0.12
Nodes (28): AGENTS, autoName(), body(), FILM_CLI, filmNames(), handler(), installed(), jobs (+20 more)

### Community 9 - "Three.js GLTF Loader (9)"
Cohesion: 0.09
Nodes (23): addMorphTargets(), addPrimitiveAttributes(), assignAttributeAccessor(), ALPHA_MODES, ATTRIBUTES, BINARY_EXTENSION_CHUNK_TYPES, computeBounds(), createAttributesKey() (+15 more)

### Community 10 - "Three.js GLTF Loader (10)"
Cohesion: 0.08
Nodes (6): GLTFLoader, GLTFMaterialsBumpExtension, GLTFMaterialsDispersionExtension, GLTFMaterialsEmissiveStrengthExtension, GLTFMeshGpuInstancing, GLTFMeshoptCompression

### Community 11 - "Three.js GLTF Loader (11)"
Cohesion: 0.08
Nodes (6): GLTFMaterialsClearcoatExtension, GLTFMaterialsIridescenceExtension, GLTFMaterialsSheenExtension, GLTFMaterialsTransmissionExtension, GLTFMaterialsVolumeExtension, GLTFTextureTransformExtension

### Community 12 - "Studio Config & Dependencies (12)"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, baseUrl, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 13 - "Studio Config & Dependencies (13)"
Cohesion: 0.19
Nodes (10): class-variance-authority, cn, radix-ui, react, buttonVariants, ScrollArea(), ScrollBar(), ToggleGroupContext (+2 more)

### Community 14 - "Components Module"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 15 - "GSAP Animation Core (15)"
Cohesion: 0.18
Nodes (21): _a(), Ao(), _assertThisInitialized(), cb(), cc(), ga(), gb(), hb() (+13 more)

### Community 16 - "Studio Config & Dependencies (16)"
Cohesion: 0.12
Nodes (19): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, @fontsource-variable/geist, globals, shadcn, tailwindcss (+11 more)

### Community 17 - "Post-Processing Shaders (17)"
Cohesion: 0.13
Nodes (5): BokehPass, OutputPass, FullScreenQuad, BokehShader, OutputShader

### Community 18 - "Project Manifest & Scripts"
Cohesion: 0.10
Nodes (19): author, dependencies, @elevenlabs/elevenlabs-js, @fontsource/fredoka, gsap, three, description, keywords (+11 more)

### Community 19 - "Studio Config & Dependencies (19)"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 20 - "Khmer Language Utilities"
Cohesion: 0.18
Nodes (10): _below_million(), digits_to_khmer(), _english_digits(), int_to_english(), int_to_khmer(), phone_to_khmer(), _range(), _read_number() (+2 more)

### Community 21 - "TTS & Voice Narration (21)"
Cohesion: 0.12
Nodes (16): audioPath, dir, duration, hash, lineOfChar, lines, r(), rawPath (+8 more)

### Community 22 - "Status Module"
Cohesion: 0.21
Nodes (17): Dashboard(), FilmCard(), PerRow, usePerRow(), LangBadge(), LengthBadge(), MOODS, StateBadge() (+9 more)

### Community 24 - "Procedural Textures"
Cohesion: 0.15
Nodes (15): cells(), cloth(), CLOTH_PATTERNS, cloths, dress(), fbm(), finish(), fr() (+7 more)

### Community 25 - "TTS & Voice Narration (25)"
Cohesion: 0.21
Nodes (6): clean(), duration(), gender_ok(), main(), median_f0(), synthesize()

### Community 27 - "Post-Processing Shaders (27)"
Cohesion: 0.15
Nodes (4): ClearMaskPass, MaskPass, Pass, RenderPass

### Community 28 - "Buffergeometryutils Module"
Cohesion: 0.14
Nodes (9): computeMikkTSpaceTangents(), computeMorphedAttributes(), deepCloneAttribute(), deinterleaveAttribute(), deinterleaveGeometry(), mergeAttributes(), mergeGeometries(), toCreasedNormals() (+1 more)

### Community 30 - "Studio Backend API (30)"
Cohesion: 0.14
Nodes (13): StepDef, Agent, AgentModel, api, FilmDetail, FilmFiles, FilmSummary, fmtBytes() (+5 more)

### Community 31 - "Blender Asset Pipeline (31)"
Cohesion: 0.23
Nodes (6): build_sets(), build_town(), export(), mat(), reset(), srgb()

### Community 32 - "Narrate Module"
Cohesion: 0.19
Nodes (8): align(), bare(), decode(), main(), chunk_path(), job(), synth(), whisper_words()

### Community 33 - "Film CLI & Planning (33)"
Cohesion: 0.13
Nodes (12): ctx, cuts, dir, events, flashes, html, lens, marks (+4 more)

### Community 34 - "Film CLI & Planning (34)"
Cohesion: 0.20
Nodes (8): [cmd, name, ...rest], HF, steps, bare(), CORE, filmDir(), OUTPUTS, ROOT

### Community 35 - "GSAP Animation Core (35)"
Cohesion: 0.22
Nodes (14): Ae(), ce(), $d(), ee(), ha(), ka(), le(), me() (+6 more)

### Community 36 - "Post-Processing Shaders (36)"
Cohesion: 0.23
Nodes (6): _camera, FullscreenTriangleGeometry, _geometry, CopyShader, LuminosityHighPassShader, three

### Community 37 - "Studio Config & Dependencies (37)"
Cohesion: 0.14
Nodes (14): dependencies, class-variance-authority, cn, @fontsource-variable/geist, lucide-react, next-themes, radix-ui, react (+6 more)

### Community 38 - "Stage & 3D Scene Engine (38)"
Cohesion: 0.27
Nodes (13): build(), canvasTex(), drawFace(), faceSet(), fill, lightness(), makeActor(), numberTex() (+5 more)

### Community 39 - "Three.js GLTF Loader (39)"
Cohesion: 0.15
Nodes (4): getImageURIMimeType(), GLTFTextureAVIFExtension, GLTFTextureBasisUExtension, GLTFTextureWebPExtension

### Community 41 - "Studio Config & Dependencies (41)"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, @types/node, @types/react (+5 more)

### Community 42 - "Shadcn UI Components (42)"
Cohesion: 0.41
Nodes (10): Stat(), Pipeline(), JobConsole(), Card(), CardAction(), CardContent(), CardDescription(), CardHeader() (+2 more)

### Community 43 - "Transcribe Module"
Cohesion: 0.29
Nodes (5): clean_text(), main(), srt_time(), write_srt(), main()

### Community 45 - "Gemini Audio Transcription (45)"
Cohesion: 0.25
Nodes (4): GeminiKeyRotator, load_api_keys(), main(), run()

### Community 46 - "Three.js GLTF Loader (46)"
Cohesion: 0.18
Nodes (3): GLTFBinaryExtension, GLTFMaterialsUnlitExtension, GLTFMeshQuantizationExtension

### Community 47 - "Post-Processing Shaders (47)"
Cohesion: 0.33
Nodes (8): generateMagicSquare(), generateMagicSquareNoise(), GTAOBlendShader, GTAODepthShader, GTAOShader, generateDenoiseSamples(), generatePdSamplePointInitializer(), PoissonDenoiseShader

### Community 49 - "Hyperframes Module"
Cohesion: 0.22
Nodes (8): media, autoProxy, paths, assets, blocks, components, registry, $schema

### Community 50 - "Skeletonutils Module"
Cohesion: 0.56
Nodes (8): clone(), getBoneByName(), getBoneName(), getBones(), getHelperFromSkeleton(), parallelTraverse(), retarget(), retargetClip()

### Community 51 - "GSAP Animation Core (51)"
Cohesion: 0.25
Nodes (6): Aa(), Ca(), na(), Vb(), wb(), Xb()

### Community 53 - "Serve Module"
Cohesion: 0.29
Nodes (3): DIST, PORT, TYPES

### Community 54 - "Stage & 3D Scene Engine (54)"
Cohesion: 0.33
Nodes (6): beam(), F(), R(), setStone(), shipBeam(), v3()

### Community 55 - "Stage & 3D Scene Engine (55)"
Cohesion: 0.47
Nodes (6): clamp01(), createFilm(), lerp(), lightRig(), renderAt(), setEnv()

### Community 56 - "GSAP Animation Core (56)"
Cohesion: 0.47
Nodes (6): Animation(), Da(), la(), ma(), Ua(), Va()

### Community 59 - "Studio Config & Dependencies (59)"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, start, typecheck

### Community 60 - "Studio Config & Dependencies (60)"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 62 - "Stage & 3D Scene Engine (62)"
Cohesion: 0.40
Nodes (5): arcPos(), crowdArc(), crowdRun(), crowdWalk(), put()

### Community 63 - "GSAP Animation Core (63)"
Cohesion: 0.40
Nodes (5): Context(), Db(), Eb(), fb(), Gw()

### Community 64 - "GSAP Animation Core (64)"
Cohesion: 0.40
Nodes (5): he(), Md(), Nd(), Od(), Pd()

### Community 65 - "GSAP Animation Core (65)"
Cohesion: 0.40
Nodes (5): kb(), ob(), ra(), rb(), Za()

### Community 66 - "GSAP Animation Core (66)"
Cohesion: 0.40
Nodes (5): Rd(), Vd(), Wd(), yd(), ye()

### Community 67 - "Studio Config & Dependencies (67)"
Cohesion: 0.40
Nodes (4): @tailwindcss/vite, vite, @vitejs/plugin-react, filmApi()

## Knowledge Gaps
- **10 isolated node(s):** `@fontsource-variable/geist`, `shadcn`, `tailwindcss`, `tw-animate-css`, `@types/node` (+5 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 489 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `three` connect `Post-Processing Shaders (36)` to `Stage & 3D Scene Engine (1)`, `Three.js GLTF Loader (9)`, `Post-Processing Shaders (47)`, `Post-Processing Shaders (17)`, `Skeletonutils Module`, `Project Manifest & Scripts`, `Procedural Textures`, `Post-Processing Shaders (27)`, `Buffergeometryutils Module`?**
  _High betweenness centrality (0.321) - this node is a cross-community bridge._
- **What connects `@fontsource-variable/geist`, `shadcn`, `tailwindcss` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Studio Sidebar UI` be split into smaller, more focused modules?**
  _Cohesion score 0.053069420539300055 - nodes in this community are weakly interconnected._
- **Why does `@elevenlabs/elevenlabs-js` connect `TTS & Voice Narration (21)` to `Project Manifest & Scripts`?**
  _High betweenness centrality (0.223) - this node is a cross-community bridge._
- **Should `Stage & 3D Scene Engine (1)` be split into smaller, more focused modules?**
  _Cohesion score 0.02702702702702703 - nodes in this community are weakly interconnected._
- **Why does `@tailwindcss/vite` connect `Studio Config & Dependencies (67)` to `Studio Config & Dependencies (16)`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Should `GSAP Animation Core (2)` be split into smaller, more focused modules?**
  _Cohesion score 0.06685633001422475 - nodes in this community are weakly interconnected._