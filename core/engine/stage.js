// Shared film engine. A film imports what it needs from here and calls createFilm().
// The picture is a pure function of time: HyperFrames seeks frames in any order,
// so renderAt(t) rebuilds the whole stage from t alone (no clocks, no deltas).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { mulberry32, dress, weave, cloth, CLOTH_PATTERNS } from "./textures.js";
import { resolveStyle } from "../styles/index.js";
import { drawFace } from "../styles/roblox/style.js";

const PLAN = window.STORY_PLAN;
const C = PLAN.cuts;
const W = 1080;
const H = 1920;
const TOWN_SCALE = 1.6;
// The film's style: a folder in core/styles/ with its own characters, town, sets, faces and light.
// Set with "style" in story.json or createFilm({ style }); every style shares bones, clips and part names.
let STYLE = resolveStyle();

// ------------------------------------------------------------------ utils
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) ** 3;
const backOut = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// --------------------------------------------------------------- renderer
const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 600);
// light cones and stars live in their own scene, drawn after post-processing
const overlay = new THREE.Scene();
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });

// sky dome: vertical gradient, blended between dusk and night
const DAY = { top: new THREE.Color("#6f8fd8"), mid: new THREE.Color("#ffb37a"), low: new THREE.Color("#ffcf9c") };
const NIGHT = { top: new THREE.Color("#0b1238"), mid: new THREE.Color("#2a3a80"), low: new THREE.Color("#5a4a9a") };
const skyU = {
  top: { value: DAY.top.clone() }, mid: { value: DAY.mid.clone() }, low: { value: DAY.low.clone() },
  sunDir: { value: new THREE.Vector3(0.38, 0.13, -1).normalize() }, sunCol: { value: new THREE.Color("#ffb46a") },
  moonDir: { value: new THREE.Vector3(-0.3, 0.6, -1).normalize() },
  night: { value: 0 }, clouds: { value: 0.9 }, time: { value: 0 },
};
// gradient + low sun glow (behind the tower, where most cameras look) + moon + drifting clouds
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir;
      uniform float night; uniform float clouds; uniform float time; varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return v; }
      void main(){ vec3 d = normalize(vP); float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(low, mid, smoothstep(-0.05, 0.16, h)); c = mix(c, top, smoothstep(0.12, 0.7, h));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (0.2 * pow(s, 9.0) + 0.6 * pow(s, 60.0) + 2.5 * smoothstep(0.9990, 0.9995, s)) * (1.0 - night);
        float m = max(dot(d, moonDir), 0.0);
        c += vec3(0.75, 0.83, 1.0) * (0.06 * pow(m, 200.0) + 1.05 * smoothstep(0.9990, 0.9993, m)) * night;
        vec2 q = d.xz / (d.y + 0.22) * 1.25 + vec2(time * 0.004, 0.0);
        float cl = smoothstep(0.5, 0.8, fbm(q)) * smoothstep(0.03, 0.24, d.y) * clouds;
        vec3 cc = mix(mix(vec3(1.0, 0.94, 0.88), sunCol * 1.2, 0.6 * pow(s, 3.0)), vec3(0.2, 0.24, 0.42), night);
        c = mix(c, cc, cl * mix(0.8, 0.45, night));
        gl_FragColor = vec4(c, 1.0); }`,
  }),
);
scene.add(sky);
scene.fog = new THREE.Fog("#ffcfa0", 60, 330);

const hemi = new THREE.HemisphereLight("#ffe6cf", "#a07c68", 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffc890", 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.12;
sun.shadow.radius = 9;
scene.add(sun, sun.target);
const fill = new THREE.PointLight("#ffd9a0", 0, 60, 1.6); // follows the subject at night
scene.add(fill);
// rim light: always behind the subject as seen from the camera, so every figure gets a lit edge
const rim = new THREE.DirectionalLight("#fff1d6", 0);
scene.add(rim, rim.target);
// street lamps: the nearest few to the subject throw real pools of light at night
const LAMPS = [];
for (const sx of [-1, 1]) for (let y = -80; y < 84; y += 18) LAMPS.push([sx * 7.4 * TOWN_SCALE, 7.0 * TOWN_SCALE, -y * TOWN_SCALE]);
const lampLights = Array.from({ length: 6 }, () => {
  const l = new THREE.SpotLight("#ffcf8f", 0, 44, 1.05, 0.75, 1.3);
  scene.add(l, l.target); return l;
});
const roomLight = new THREE.PointLight("#ffc98a", 0, 46, 1.5); // the bedside lamp
roomLight.position.set(300 + 8.6, 7.4, 0.6);
scene.add(roomLight);
// image-based light: a soft studio sky, so glass, paint, metal and skin pick up reflections
{
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec3 vP;
      void main(){ vec3 d = normalize(vP);
        vec3 c = mix(vec3(0.2, 0.18, 0.17), vec3(1.0, 0.92, 0.84), smoothstep(-0.25, 0.05, d.y));
        c = mix(c, vec3(0.5, 0.66, 1.0), smoothstep(0.05, 0.8, d.y));
        c += vec3(3.0, 2.6, 2.0) * pow(max(dot(d, normalize(vec3(-0.6, 0.55, 0.5))), 0.0), 24.0);
        gl_FragColor = vec4(c, 1.0); }`,
  })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(es, 0.03).texture;
  pmrem.dispose();
}

// ------------------------------------------------------------ post-processing
// ambient occlusion -> depth of field -> bloom -> tone mapping -> grade.
// Every pass depends only on the current frame, so seeking stays deterministic.
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, W, H);
gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.00006, maxblur: 0.009 });
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.7, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// the film look: lens fringing, gentle S-curve, cool shadows / warm highlights, vignette, grain
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, vig: { value: 0.32 }, sat: { value: 1.16 }, tint: { value: new THREE.Vector3(1, 1, 1) },
    contrast: { value: 0.36 }, split: { value: 0.05 }, grain: { value: 0.035 }, fringe: { value: 0.0016 }, seed: { value: 0 },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float sat; uniform vec3 tint;
    uniform float contrast; uniform float split; uniform float grain; uniform float fringe; uniform float seed; varying vec2 vUv;
    float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){ vec2 d = vUv - 0.5; vec2 off = d * dot(d, d) * fringe * 4.0;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r; c.b = texture2D(tDiffuse, vUv - off).b;
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), contrast);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat) * tint;
      c.rgb *= mix(vec3(1.0 - split, 1.0, 1.0 + split * 1.4), vec3(1.0 + split, 1.0 + split * 0.3, 1.0 - split), smoothstep(0.15, 0.75, l));
      c.rgb *= 1.0 - vig * smoothstep(0.25, 0.85, length(d * vec2(0.9, 1.25)));
      float g = hash(gl_FragCoord.xy + seed * 17.0) - 0.5;
      c.rgb += g * grain * (0.35 + 0.65 * (1.0 - abs(2.0 * l - 1.0)));
      gl_FragColor = c; }`,
});
composer.addPass(grade);

// ---------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, flipY = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = flipY; // glTF UVs want false
  t.anisotropy = 8;
  return t;
}

const EXPRS = ["neutral", "happy", "shock", "sad", "smug", "angry", "sleep"];
// faces and chest prints are drawn in a 256 space but stored at 512, so close-ups stay sharp
const faceSet = (o) => Object.fromEntries(EXPRS.map((e) => [e, canvasTex(512, 512, (g) => { g.scale(2, 2); STYLE.drawFace(g, e, o); })]));

const CHESTS = {
  zero: (g) => {
    g.font = "900 190px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#1c1f2b"; g.fillText("0", 128, 120);
  },
  stripes: (g) => { g.fillStyle = "#17171c"; for (let y = 0; y < 256; y += 52) g.fillRect(0, y, 256, 26); },
  moon: (g) => {
    g.fillStyle = "#ffd23c"; g.beginPath(); g.arc(128, 112, 62, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(156, 94, 56, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  },
  zipper: (g) => {
    g.fillStyle = "#8a6a14"; g.fillRect(122, 0, 12, 256);
    g.fillStyle = "#e8e8ee"; for (let y = 6; y < 256; y += 16) g.fillRect(118, y, 20, 7);
    g.fillStyle = "#c98f1a"; g.fillRect(34, 150, 60, 10); g.fillRect(162, 150, 60, 10);
  },
  planet: (g) => {
    g.fillStyle = "#2ec4b6"; g.beginPath(); g.arc(128, 110, 44, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#ffd23c"; g.lineWidth = 12; g.beginPath(); g.ellipse(128, 110, 76, 20, -0.35, 0, Math.PI * 2); g.stroke();
  },
  sash: (g) => {
    g.fillStyle = "#d8463f"; g.beginPath(); g.moveTo(0, 0); g.lineTo(60, 0); g.lineTo(256, 196); g.lineTo(256, 256); g.lineTo(196, 256); g.lineTo(0, 60); g.fill();
    g.fillStyle = "#ffd23c"; g.beginPath(); g.arc(70, 190, 26, 0, Math.PI * 2); g.fill();
  },
  none: () => {},
};

const defaultBoard = (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0b1030"); grad.addColorStop(1, "#05060f");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#8fd3ff"; g.font = "700 84px Fredoka, Arial Black, sans-serif"; g.fillText("TOWN", w / 2, 420);
  g.fillStyle = "#ffe44a"; g.fillText("NEWS", w / 2, 540);
};
/** window pane texture: "day", "night" or "lit"; extra(g) draws inside the pane (e.g. a silhouette) */
const windowTex = (mode, extra = null) => canvasTex(256, 256, (g) => {
  if (mode === "day") { const s = g.createLinearGradient(0, 0, 0, 256); s.addColorStop(0, "#8fc7ff"); s.addColorStop(1, "#dff1ff"); g.fillStyle = s; g.fillRect(0, 0, 256, 256); }
  else if (mode === "night") {
    g.fillStyle = "#0e1640"; g.fillRect(0, 0, 256, 256);
    const r = mulberry32(5); g.fillStyle = "#fff";
    for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(r() * 256, r() * 256, 0.8 + r() * 1.8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "#8dff9a"; g.beginPath(); g.arc(170, 70, 9, 0, Math.PI * 2); g.fill();
  } else { g.fillStyle = "#ffd98a"; g.fillRect(0, 0, 256, 256); }
  if (extra) extra(g);
  g.strokeStyle = "#f6f1e7"; g.lineWidth = 12; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
});

// floating number / label badges above heads (drawn crisp, after post-processing)
const numCache = new Map();
function numberTex(text, color) {
  const key = text + "|" + color;
  if (!numCache.has(key)) {
    numCache.set(key, canvasTex(320, 200, (g) => {
      g.fillStyle = "rgba(14,16,30,0.82)";
      g.beginPath(); g.roundRect(18, 22, 284, 156, 46); g.fill();
      g.lineWidth = 10; g.strokeStyle = color; g.stroke();
      g.font = "700 138px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = color; g.fillText(text, 160, 108);
    }, true));
  }
  return numCache.get(key);
}

// ------------------------------------------------------------------- cast
// The shared family. A film adds its own characters through createFilm({ cast }).
// "fit" lists the clothing pieces a character wears (see FITS below), "cloth" prints a pattern
// on a garment: { Shirt | Pants | Skirt: "stripes" or ["stripes", secondColour] }.
const CAST = {
  zero: { hair: "Zero", scale: 0.86, chest: "zero", face: { blush: true, brow: "#27304f" }, fit: ["Short", "Crew"],
    col: { Skin: "#f4cda6", Shirt: "#f3f3f6", Pants: "#2f3a56", Shoes: "#2ec4b6", Hair: "#27304f", Trim: "#2ec4b6" } },
  zeebra: { hair: "Zeebra", scale: 1.0, chest: "none", face: { brow: "#17171c" }, fit: ["Long", "Crew"], cloth: { Shirt: ["stripes", "#17171c"] },
    col: { Skin: "#eec39a", Shirt: "#f3f3f6", Pants: "#1d1d22", Shoes: "#f4f4f4", Hair: "#17171c", HairStreak: "#ffffff", Acc: "#e23d3d", Trim: "#17171c" } },
  luna: { hair: "Luna", scale: 1.05, chest: "moon", face: { lashes: true, blush: true, brow: "#4a2c78" }, fit: ["Long", "Crew", "Skirt"],
    col: { Skin: "#f6d3b0", Shirt: "#2c3e7a", Pants: "#3d2c66", Skirt: "#6b4fa0", Shoes: "#f4f4f4", Hair: "#5b3a8c", Acc: "#ffd23c", Trim: "#ffd23c" } },
  zip: { hair: "Zip", scale: 1.1, chest: "zipper", face: { mustache: "#6b4226", brow: "#6b4226" }, fit: ["Long", "Collar", "Belt"],
    col: { Skin: "#e9bd92", Shirt: "#f2b632", Pants: "#3a4a6b", Shoes: "#5a3b28", Hair: "#6b4226", Acc: "#2b6cb0", HairStreak: "#ffffff", Trim: "#c98f1a", Belt: "#5a3b28" } },
  // the town's mayor: not family, but shared by every film that needs him
  mayor: { hair: "Mayor", scale: 1.08, chest: "sash", face: { mustache: "#8a8a92", brow: "#55555e" }, fit: ["Long", "Jacket", "Belt"],
    col: { Skin: "#e9bd92", Shirt: "#5b3a8c", Pants: "#2b2b33", Shoes: "#17171c", Hair: "#1b1b22", HairStreak: "#8a8a92", Acc: "#d8463f", Trim: "#3f2866" } },
};
/** clothing pieces: sleeves (Short | Long cuffs; neither = plain long sleeves), legs (Shorts),
 *  neck (Crew | Collar | Scarf), body (Hood | Jacket | Tie | Belt | Pack), Skirt */
const FITS = ["Short", "Long", "Shorts", "Crew", "Collar", "Scarf", "Hood", "Jacket", "Tie", "Belt", "Pack", "Skirt"];
const _hsl = {};
/** lighter (k > 0) or darker (k < 0) version of a colour */
const shade = (hex, k) => {
  const c = new THREE.Color(hex); c.getHSL(_hsl, THREE.SRGBColorSpace);
  return "#" + c.setHSL(_hsl.h, _hsl.s, clamp01(_hsl.l + k), THREE.SRGBColorSpace).getHexString();
};
const lightness = (hex) => new THREE.Color(hex).getHSL(_hsl, THREE.SRGBColorSpace).l;
/** every material colour of a character, with the clothing ones derived when not given in def.col */
function outfit(def) {
  const c = def.col || {}, fit = new Set(def.fit || []);
  const b = { Skin: "#f2c9a0", Shirt: "#e9e9ee", Pants: "#2f3a56", Shoes: "#f4f4f4", Hair: "#2a2440", HairStreak: "#ffffff", Acc: "#ffd23c", ...c };
  const trim = c.Trim || shade(b.Shirt, lightness(b.Shirt) > 0.75 ? -0.2 : -0.1);
  const short = fit.has("Short"), shorts = fit.has("Shorts");
  const col = {
    ...b, Sleeve: c.Sleeve || b.Shirt, Forearm: c.Forearm || (short ? b.Skin : c.Sleeve || b.Shirt),
    Cuff: c.Cuff || trim, Collar: c.Collar || trim, Belt: c.Belt || "#2a2422",
    Shin: c.Shin || (shorts ? b.Skin : b.Pants), PantsHem: shade(b.Pants, -0.06),
    Sole: c.Sole || (lightness(b.Shoes) > 0.8 ? "#b9b4aa" : "#f4f1ea"),
    Inner: c.Inner || "#f4f1ea", Skirt: c.Skirt || b.Pants, Pack: c.Pack || b.Acc,
  };
  // which garment a material belongs to (for printed cloth and the weave)
  const garment = {
    Shirt: "Shirt", Sleeve: c.Sleeve ? null : "Shirt", Forearm: c.Forearm || short ? null : "Shirt",
    Pants: "Pants", Shin: c.Shin || shorts ? null : "Pants", Skirt: "Skirt",
  };
  return { col, fit, garment };
}
// [bump map, bump strength, roughness, metalness] per character material
const SKINS_OF = {
  Skin: [null, 0, 0.62, 0], Hair: ["hair", 0.4, 0.5, 0], HairStreak: ["hair", 0.4, 0.5, 0],
  Shirt: ["fabric", 0.55, 0.9, 0], Sleeve: ["fabric", 0.55, 0.9, 0], Forearm: ["fabric", 0.55, 0.9, 0],
  Cuff: ["knit", 0.8, 0.9, 0], Collar: ["knit", 0.8, 0.9, 0], Inner: ["fabric", 0.5, 0.9, 0], Skirt: ["fabric", 0.6, 0.9, 0],
  Pants: ["denim", 0.6, 0.86, 0], Shin: ["denim", 0.6, 0.86, 0], PantsHem: ["denim", 0.6, 0.86, 0],
  Shoes: [null, 0, 0.42, 0], Sole: [null, 0, 0.7, 0], Belt: [null, 0, 0.45, 0.1], Pack: ["fabric", 0.8, 0.8, 0], Acc: [null, 0, 0.35, 0.25],
};
const CROWD_N = 14;
const PALETTE = ["#e76f51", "#2a9d8f", "#e9c46a", "#8ab17d", "#577590", "#f28482", "#84a59d", "#b56576", "#6d597a", "#f4a261"];
const SKINS = ["#f4cda6", "#e0ac84", "#c68c63", "#8d5a3b", "#f6d9bd"];
const HAIRS = ["#2a2440", "#6b4226", "#c9a227", "#b23a48", "#111111", "#d9d9d9"];

const A = {};
const crowd = [];
const clipDur = {};
const townMats = {};
let ready = false;

function makeActor(base, clips, def) {
  const root = new THREE.Group();
  const model = cloneSkinned(base);
  model.scale.setScalar(def.scale * STYLE.size);
  root.add(model);
  const faces = faceSet(def.face || {});
  const chestTex = canvasTex(512, 512, (g) => { g.scale(2, 2); CHESTS[def.chest || "none"](g); });
  const { col, fit, garment } = outfit(def);
  let faceMat;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.name.startsWith("M_Hair_")) o.visible = o.name.startsWith("M_Hair_" + def.hair);
    if (o.name.startsWith("M_Fit_")) o.visible = fit.has(o.name.split("_")[2]);
    const fix = (m) => {
      if (m.name === "Face" || m.name === "Chest") {
        const nm = new THREE.MeshStandardMaterial({
          map: m.name === "Face" ? faces.neutral : chestTex, transparent: true, alphaTest: 0.04,
          roughness: m.name === "Face" ? STYLE.faceRoughness : 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        });
        nm.name = m.name;
        if (m.name === "Face") faceMat = nm;
        return nm;
      }
      const skin = m.name === "Skin" || (m.name === "Forearm" && col.Forearm === col.Skin) || (m.name === "Shin" && col.Shin === col.Skin);
      const nm = skin && STYLE.skin ? STYLE.skin() : m.clone();
      nm.name = m.name;
      if (col[m.name]) nm.color.set(col[m.name]);
      const [bump, strength, rough, metal] = SKINS_OF[m.name] || [null, 0, 0.82, 0];
      nm.roughness = rough; nm.metalness = metal;
      if (skin) { nm.roughness = STYLE.skinRoughness; }
      else if (bump) { nm.normalMap = weave(bump); nm.normalScale.set(strength, strength); }
      const print = !skin && garment[m.name] && def.cloth && def.cloth[garment[m.name]];
      if (print) { // printed cloth carries its own colours
        const [pattern, second] = [].concat(print);
        nm.map = cloth(pattern, col[m.name], second || shade(col[m.name], lightness(col[m.name]) > 0.5 ? -0.3 : 0.25));
        nm.color.set("#ffffff");
      }
      if (def.glow && m.name === "Acc") { nm.emissive.set(col.Acc); nm.emissiveIntensity = 1.6; }
      return nm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    const decal = o.name === "M_Face" || o.name === "M_Chest";
    o.castShadow = !decal; o.receiveShadow = !decal;
  });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of clips) { actions[clip.name] = mixer.clipAction(clip); actions[clip.name].play(); }
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex("0", "#ffffff"), fog: false, depthWrite: false, toneMapped: false }));
  const headY = STYLE.headY * def.scale;
  badge.visible = false;
  overlay.add(badge);
  scene.add(root);
  const self = {
    root, def,
    /** blend up to two clips; times are in seconds and loop (Shock holds its end pose) */
    pose(a, ta, b = null, wb = 0, tb = ta) {
      for (const k in actions) actions[k].setEffectiveWeight(0);
      const put = (name, time, w) => {
        const d = clipDur[name];
        actions[name].time = name === "Shock" ? Math.min(Math.max(time, 0), d - 0.001) : ((time % d) + d) % d;
        actions[name].setEffectiveWeight(w);
      };
      put(a, ta, 1 - wb);
      if (b && wb > 0) put(b, tb, wb);
      mixer.update(0);
      return self;
    },
    face(expr) { faceMat.map = faces[expr]; return self; },
    place(x, z, ry = 0, y = 0, size = 1) {
      root.visible = true; root.position.set(x, y, z); root.rotation.set(0, ry, 0); root.scale.setScalar(size);
      return self;
    },
    /** floating badge above the head; call after place(). null hides it */
    number(text, color = "#ffffff", s = 1, dx = 0, dy = 0) {
      badge.visible = text !== null;
      if (text === null) return self;
      badge.material.map = numberTex(String(text), color);
      badge.scale.set(2.0 * s, 1.25 * s, 1);
      badge.position.set(root.position.x + dx, root.position.y + headY + 1.15 + 0.45 * (s - 1) + dy, root.position.z);
      return self;
    },
  };
  return self;
}
/** place + pose + face in one call */
const put = (a, x, z, ry, clip, tt, face, y = 0, size = 1) => a.place(x, z, ry, y, size).pose(clip, tt).face(face);

// ------------------------------------------------------------ sets and props
const SETS = {};          // town, house, room, forest
let board, boardTex0, car, carPaint, ship, shipMats = {}, roomWindow, houseWindow, winTex = {};
const ROOM = v3(300, 0, 0), FOREST = v3(-300, 0, 0), HOUSE_Z = 64, SHIP_X = 0, SHIP_Z = 18;
const R = (x, y, z) => v3(ROOM.x + x, y, z);
const F = (x, y, z) => v3(FOREST.x + x, y, z);

const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0),
  new THREE.MeshStandardMaterial({ color: "#3cff7a", emissive: "#3cff7a", emissiveIntensity: 2, roughness: 0.3 }));
const stoneLight = new THREE.PointLight("#5dff8a", 0, 12, 1.6);
const glow = new THREE.PointLight("#6dff9a", 0, 80, 1.5); // crater / ship glow
scene.add(stone, stoneLight, glow);
function setStone(pos, power = 1) {
  stone.visible = true; stone.position.copy(pos);
  stone.material.emissiveIntensity = 0.3 + 2.2 * power;
  stoneLight.position.copy(pos).add(v3(0, 0.6, 0.6)); stoneLight.intensity = 7 * power;
}

const pancakes = new THREE.Group();
{
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.0, 0.14, 24), new THREE.MeshStandardMaterial({ color: "#f6f1e7", roughness: 0.5 }));
  pancakes.add(plate);
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 20), new THREE.MeshStandardMaterial({ color: i % 2 ? "#e3a65a" : "#d9954a", roughness: 0.8 }));
    p.position.set(0.05 * Math.sin(i * 2.1), 0.17 + i * 0.21, 0.05 * Math.cos(i * 1.7)); p.castShadow = true;
    p.userData.cake = i; pancakes.add(p);
  }
  scene.add(pancakes);
}
function setPancakes(pos, count) {
  pancakes.visible = true; pancakes.position.copy(pos);
  pancakes.children.forEach((c) => { if (c.userData.cake !== undefined) c.visible = c.userData.cake < count; });
}

const books = [0, 1].map((i) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.1), new THREE.MeshStandardMaterial({ color: i ? "#2a9d8f" : "#e76f51", roughness: 0.8 }));
  b.castShadow = true; scene.add(b); return b;
});
const puffs = Array.from({ length: 7 }, () => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#8a8a92", roughness: 1, flatShading: true }));
  scene.add(m); return m;
});
function smoke(pos, t, size = 1) {
  puffs.forEach((m, i) => {
    const k = ((t * 0.55 + i / puffs.length) % 1 + 1) % 1;
    m.visible = true;
    m.position.set(pos.x + Math.sin(i * 2.4 + t) * 0.5 * k * size, pos.y + k * 4.5 * size, pos.z + Math.cos(i * 1.9) * 0.4 * k * size);
    m.scale.setScalar(size * (0.35 + 0.9 * k) * (1 - k * 0.55));
  });
}
const sparks = Array.from({ length: 12 }, () => {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: "#b6ff6a", emissive: "#b6ff6a", emissiveIntensity: 4 }));
  scene.add(m); return m;
});
function sparkle(pos, t, radius = 3, color = "#b6ff6a") {
  sparks.forEach((m, i) => {
    const k = ((t * 0.9 + i / sparks.length) % 1 + 1) % 1, a = i * 2.399 + t * 1.3;
    m.visible = true; m.material.color.set(color); m.material.emissive.set(color);
    m.position.set(pos.x + Math.cos(a) * radius * (0.4 + 0.6 * k), pos.y + (k - 0.3) * radius * 1.3, pos.z + Math.sin(a) * radius * (0.4 + 0.6 * k));
    m.scale.setScalar(1.6 * Math.sin(Math.PI * k)); m.rotation.set(t * 3 + i, t * 2, 0);
  });
}

// additive light cones and stars are drawn in the overlay scene, after post-processing
const coneGeo = new THREE.ConeGeometry(1, 1, 28, 1, true).translate(0, -0.5, 0);
const beams = Array.from({ length: 5 }, () => {
  const m = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    color: "#fff1c2", transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false, toneMapped: false }));
  overlay.add(m); return m;
});
const DOWN = v3(0, -1, 0), _d = v3(0, 0, 0);
function beam(i, from, to, radius, color = "#fff1c2", opacity = 0.2) {
  const m = beams[i];
  m.visible = true; m.material.color.set(color); m.material.opacity = opacity;
  _d.subVectors(to, from);
  const len = _d.length();
  m.position.copy(from); m.scale.set(radius, len, radius);
  m.quaternion.setFromUnitVectors(DOWN, _d.normalize());
}
const starGeo = new THREE.BufferGeometry();
{
  const r = mulberry32(99), pts = [];
  for (let i = 0; i < 500; i++) {
    const a = r() * Math.PI * 2, e = 0.08 + r() * 1.45;
    pts.push(Math.cos(a) * Math.cos(e) * 460, Math.sin(e) * 460, Math.sin(a) * Math.cos(e) * 460);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#ffffff", size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, toneMapped: false, depthWrite: false }));
overlay.add(stars);
const greenStar = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: "#8dff9a", fog: false, toneMapped: false }));
overlay.add(greenStar);

// -------------------------------------------------------------- environment
const GREEN = { top: new THREE.Color("#0f5a34"), mid: new THREE.Color("#178a4a"), low: new THREE.Color("#8dffb0") };
const _c = new THREE.Color();
const env = { n: 0, green: 0, red: 0 };
function setEnv(n, green = 0, red = 0) {
  env.n = n; env.green = green; env.red = red;
  for (const k of ["top", "mid", "low"]) skyU[k].value.lerpColors(DAY[k], NIGHT[k], n).lerp(GREEN[k], green);
  skyU.night.value = n; skyU.clouds.value = lerp(0.9, 0.55, n) * (1 - 0.6 * green);
  skyU.sunCol.value.set("#ffb46a").lerp(_c.set("#ff5a3a"), red * 0.6);
  scene.fog.color.set("#ffcfa0").lerp(_c.set("#1a2150"), n).lerp(_c.set("#1c6a40"), green * 0.8);
  // cool sky fill against a warm key by day; blue ambient under a pale moon key at night
  hemi.color.set("#dde6ff").lerp(_c.set("#5f78d8"), n).lerp(_c.set("#7dffb0"), green * 0.7);
  hemi.groundColor.set("#b08a6c").lerp(_c.set("#1c1a3a"), n);
  hemi.intensity = lerp(0.92, 0.8, n);
  sun.color.set("#ffc68c").lerp(_c.set("#8fa8ff"), n).lerp(_c.set("#9dffb8"), green * 0.6);
  sun.intensity = lerp(2.7, 1.2, n);
  rim.color.set("#ffe2b8").lerp(_c.set("#9db6ff"), n).lerp(_c.set("#9dffc0"), green * 0.7).lerp(_c.set("#ff6a50"), red * 0.6);
  rim.intensity = lerp(1.5, 1.7, n);
  scene.environmentIntensity = lerp(0.42, 0.2, n);
  bloom.strength = lerp(0.24, 0.5, n);
  bloom.threshold = lerp(1.08, 1.0, n);
  fill.intensity = 80 * n;
  renderer.toneMappingExposure = lerp(1.0, 1.12, n);
  grade.uniforms.tint.value.set(1 + 0.3 * red, 1 - 0.3 * red, 1 - 0.3 * red);
  grade.uniforms.vig.value = 0.34 + 0.35 * red;
  if (townMats.Glass) townMats.Glass.emissiveIntensity = lerp(0.0, 1.5, n);
  if (townMats.LampGlow) townMats.LampGlow.emissiveIntensity = lerp(0.25, 3.2, n);
  if (townMats.HouseGlass) townMats.HouseGlass.emissiveIntensity = lerp(0.0, 1.5, n);
  if (townMats.RoomLamp) townMats.RoomLamp.emissiveIntensity = lerp(0.3, 3.0, n);
  stars.material.opacity = clamp01(n * 1.4 - 0.4) * (1 - green * 0.7);
  if (STYLE.look) STYLE.look({ skyU, scene, hemi, sun, bloom, grade, renderer, GREEN }, n, green, red);
}

const MOODS = { day: [0, 0, 0], dusk: [0.42, 0, 0], night: [1, 0, 0], red: [0.25, 0, 1], nightred: [1, 0, 0.7], green: [1, 1, 0] };

const _p = v3(0, 0, 0), _t = v3(0, 0, 0);
function cam(t, p0, t0, p1, t1, u, shake = 0, fov = 55) {
  _p.lerpVectors(p0, p1, u); _t.lerpVectors(t0, t1, u);
  const dist = _p.distanceTo(_t);
  // a breath of handheld drift so locked-off shots never look frozen
  const drift = 0.003 * dist;
  _p.x += drift * Math.sin(t * 0.9 + 0.7); _p.y += drift * 0.7 * Math.sin(t * 0.63 + 2.1);
  if (shake) {
    _p.x += shake * Math.sin(t * 31.0); _p.y += shake * 0.7 * Math.sin(t * 43.0 + 1.3);
    _t.x += shake * 0.6 * Math.sin(t * 37.0 + 2.1); _t.y += shake * 0.6 * Math.sin(t * 29.0 + 0.4);
  }
  camera.fov = fov; camera.position.copy(_p); camera.lookAt(_t); camera.updateProjectionMatrix();
  bokeh.uniforms.focus.value = dist;
  bokeh.uniforms.aperture.value = dist < 16 ? 0.00019 : dist < 30 ? 0.00007 : 0.000014;
}
/** lights that follow the shot: called once per frame after the shot has set its camera and mood */
const _l = v3(0, 0, 0);
function lightRig(set) {
  const fx = Math.round(_t.x / 4) * 4, fz = Math.round(_t.z / 4) * 4;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx - 55, 62, fz + 38);
  _d.subVectors(_p, _t).setY(0);
  if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
  _d.normalize();
  fill.position.set(_t.x + _d.x * 8 + 2, _t.y + 5, _t.z + _d.z * 8);
  // rim: behind the subject and a little to the side opposite the key
  rim.target.position.copy(_t);
  rim.position.set(_t.x - _d.x * 40 + _d.z * 16, _t.y + 30, _t.z - _d.z * 40 - _d.x * 16);
  // lamp pools: the six lamps nearest the subject
  const town = set === "town" || set === "house", power = town ? clamp01((env.n - 0.25) / 0.6) : 0;
  const near = power > 0 ? LAMPS.map((l) => [(l[0] - _t.x) ** 2 + (l[2] - _t.z) ** 2, l]).sort((a, b) => a[0] - b[0]) : [];
  lampLights.forEach((l, i) => {
    l.intensity = power > 0 ? 95 * power : 0;
    if (!near[i]) return;
    const [x, y, z] = near[i][1];
    l.position.set(x, y, z); l.target.position.set(x * 0.72, 0, z);
  });
  roomLight.intensity = set === "room" ? 4 + 20 * env.n : 0;
}
// crowd helpers (deterministic)
const rnd = mulberry32(20261115);
const WALK = Array.from({ length: CROWD_N }, (_, i) => ({
  x: (i % 2 ? 1 : -1) * (2.5 + rnd() * 8.5), z: -34 + rnd() * 78, dir: rnd() < 0.5 ? 1 : -1,
  speed: 3.6 + rnd() * 1.6, phase: rnd() * 2,
}));
function crowdWalk(t, { count = CROWD_N, behind = null, face = "neutral" } = {}) {
  for (let i = 0; i < count; i++) {
    const w = WALK[i];
    const z = ((w.z + w.dir * w.speed * t + 40) % 84 + 84) % 84 - 40;
    if (behind !== null && z > behind - 4) continue;
    put(crowd[i], w.x, z, w.dir > 0 ? 0 : Math.PI, "Walk", t * 1.15 + w.phase, face);
  }
}
/** everyone runs along z; dir +1 runs towards +z */
function crowdRun(t, d, { dir = 1, z0 = -30, gap = 3.4, speed = 15, face = "shock", spread = 0.9, from = 0 } = {}) {
  for (let i = from; i < CROWD_N; i++) {
    const w = WALK[i];
    put(crowd[i], w.x * spread, z0 + dir * (d * speed - i * gap), dir > 0 ? 0.1 * Math.sin(i) : Math.PI + 0.1 * Math.sin(i), "Run", t * 1.6 + w.phase, face);
  }
}
/** the mob standing in an arc in front of the family house, facing it */
const arcPos = (i) => { const x = -15 + i * (30 / (CROWD_N - 1)); return [x, 33 + 7 * (x / 15) ** 2]; };
function crowdArc(t, clip, face, { tOff = 0.23 } = {}) {
  for (let i = 0; i < CROWD_N; i++) { const [x, z] = arcPos(i); put(crowd[i], x, z, 0, clip, t + i * tOff, face); }
}
function setCar(x, z, ry, color, o = {}) {
  car.visible = true; car.position.set(x, o.y || 0, z); car.rotation.set(o.rx || 0, ry, o.rz || 0); car.scale.setScalar(o.s || 1);
  carPaint.color.set(color);
}
function setShip(y, power = 1) {
  ship.visible = true; ship.position.set(SHIP_X, y, SHIP_Z);
  shipMats.ShipLight.emissiveIntensity = 1.6 * power; shipMats.ShipHatch.emissiveIntensity = 0.16 * power;
  glow.position.set(SHIP_X, y - 14, SHIP_Z); glow.intensity = 500 * power; glow.distance = 160;
}
const shipBeam = (y, o = 0.22) => beam(4, v3(SHIP_X, y - 8, SHIP_Z), v3(SHIP_X, 0, SHIP_Z), 11, "#8dffb0", o);

function renderAt(t) {
  if (!ready) return;
  t = Math.min(Math.max(t, 0), PLAN.duration - 1e-4);
  // reset the stage
  for (const k in A) { A[k].root.visible = false; A[k].number(null); }
  for (const a of crowd) { a.root.visible = false; a.number(null); }
  for (const o of [stone, pancakes, car, ship, greenStar, ...books, ...puffs, ...sparks, ...beams]) o.visible = false;
  stoneLight.intensity = 0; glow.intensity = 0;
  board.material.map = boardTex0;
  if (townMats.TowerLight) townMats.TowerLight.emissiveIntensity = 0.8;
  let i = ORDER.length - 1;
  while (i > 0 && t < C[ORDER[i]]) i--;
  const [id, env, stage] = SHOT_BY_ID[ORDER[i]];
  const start = C[id], end = i + 1 < ORDER.length ? C[ORDER[i + 1]] : PLAN.duration;
  const [set, mood] = env.split(" ");
  SETS.town.visible = set === "town" || set === "house";
  SETS.house.visible = set === "house";
  SETS.room.visible = set === "room";
  SETS.forest.visible = set === "forest";
  setEnv(...MOODS[mood]);
  const night = MOODS[mood][0] > 0.6;
  roomWindow.material.map = night ? winTex.night : winTex.day;
  houseWindow.material.map = winTex.lit;
  houseWindow.material.color.setScalar(night ? 0.95 : 0.5);
  if (set === "forest") { glow.position.copy(F(0, 9, -5)); glow.intensity = 110; glow.distance = 60; }
  try {
    stage(t, clamp01((t - start) / (end - start)), start);
  } catch (err) { // a broken shot must not leave the previous frame on screen unnoticed
    console.error(`shot "${id}" failed at ${t.toFixed(2)} s:`, err);
    throw err;
  }
  lightRig(set);
  skyU.time.value = t;
  grade.uniforms.seed.value = Math.round(t * 30) % 4096; // grain changes every frame, same on every seek
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  composer.render();
  // overlay: refill depth from the 3D scene, then draw light cones and stars on top
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  renderer.clearDepth();
  scene.overrideMaterial = depthOnly;
  sky.visible = false;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  sky.visible = true;
  renderer.render(overlay, camera);
  renderer.autoClear = true;
}

// ---------------------------------------------------------------------- load
async function build(config) {
  await document.fonts.load('700 100px "Fredoka"');
  const loader = new GLTFLoader();
  const [charGltf, townGltf, setsGltf] = await Promise.all([
    ...["character", "town", "sets"].map((f) => loader.loadAsync(`${STYLE.assets}/${f}.glb`)),
  ]);
  for (const c of charGltf.animations) clipDur[c.name] = c.duration;
  for (const k in CAST) A[k] = makeActor(charGltf.scene, charGltf.animations, CAST[k]);
  const r = mulberry32(77);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  // clothing for the crowd comes from its own stream, so the colours above stay as they were
  const r2 = mulberry32(177);
  const pick2 = (arr) => arr[Math.floor(r2() * arr.length)];
  const TOPS = [["Short", "Crew"], ["Long", "Crew"], ["Long", "Hood"], ["Long", "Collar", "Belt"], ["Short", "Collar"], ["Long", "Jacket"], ["Short", "Crew", "Shorts"], ["Long", "Crew", "Skirt"]];
  const crowdLook = () => {
    const fit = [...pick2(TOPS)];
    if (r2() < 0.2) fit.push("Scarf");
    if (r2() < 0.22) fit.push("Pack");
    const print = r2() < 0.45 ? { Shirt: pick2(["stripes", "plaid", "dots", "checks", "pinstripe"]) } : null;
    return print ? { fit, cloth: print } : { fit };
  };
  for (let i = 0; i < CROWD_N; i++) {
    crowd.push(makeActor(charGltf.scene, charGltf.animations, {
      hair: pick(["Zero", "Luna", "Zip", "Zero"]), scale: 0.92 + r() * 0.2, chest: "none", face: { blush: r() < 0.4 },
      col: { Skin: pick(SKINS), Shirt: pick(PALETTE), Pants: pick(["#2f3a56", "#3b3b46", "#5a4636", "#3f5a4a"]),
        Shoes: pick(["#f4f4f4", "#2b2b33", "#b23a48"]), Hair: pick(HAIRS), Acc: pick(PALETTE), HairStreak: "#ffffff" },
      ...crowdLook(i),
    }));
  }
  const shadows = (root, mats) => root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of [].concat(o.material)) { if (!mats[m.name]) dress(m); mats[m.name] = m; }
  });
  const town = townGltf.scene;
  town.scale.setScalar(TOWN_SCALE);
  shadows(town, townMats);
  board = town.getObjectByName("BoardScreen");
  boardTex0 = canvasTex(512, 1024, config.board || defaultBoard);
  board.material = new THREE.MeshBasicMaterial({ map: boardTex0, color: new THREE.Color(1.4, 1.4, 1.4), fog: false });
  board.castShadow = false;
  SETS.town = town; scene.add(town);

  const S = setsGltf.scene;
  shadows(S, townMats);
  const grab = (...names) => { const g = new THREE.Group(); names.forEach((n) => g.add(S.getObjectByName(n))); scene.add(g); return g; };
  SETS.room = grab("Room", "RoomWindow"); SETS.room.position.copy(ROOM);
  SETS.forest = grab("Forest", "Saucer"); SETS.forest.position.copy(FOREST);
  const saucer = SETS.forest.getObjectByName("Saucer"); saucer.rotation.z = 0.28; saucer.position.y = -0.5;
  townMats.SaucerGlass.emissiveIntensity = 0.45; townMats.SaucerLight.emissiveIntensity = 1.4; townMats.CarLight.emissiveIntensity = 0.5;
  SETS.house = grab("House", "HouseWindow"); SETS.house.position.set(0, 0, HOUSE_Z); SETS.house.rotation.y = Math.PI;
  car = grab("Car"); carPaint = townMats.CarPaint;
  townMats.ShipHatch.color.set("#2f6b45");
  ship = grab("Mothership"); shipMats = townMats;
  winTex = { day: windowTex("day"), night: windowTex("night"), lit: windowTex("lit") };
  roomWindow = SETS.room.getObjectByName("RoomWindow");
  roomWindow.material = new THREE.MeshBasicMaterial({ map: winTex.day, fog: false }); roomWindow.castShadow = false;
  houseWindow = SETS.house.getObjectByName("HouseWindow");
  houseWindow.material = new THREE.MeshBasicMaterial({ map: winTex.lit, fog: false }); houseWindow.castShadow = false;
  if (config.setup) await config.setup();
  ready = true;
  renderAt(window.__hfThreeTime || 0);
}

let SHOT_BY_ID = {}, ORDER = [];
/**
 * Start a film.
 *   id     unique name (used for the HyperFrames build hold)
 *   style  a folder name in core/styles/ ("roblox" by default); story.json's "style" sets it too
 *   cast   extra characters: { name: { hair, scale, chest, face, glow, col } }
 *   chests extra chest decals: { name: (g) => draw on a 256x256 canvas }
 *   board  (g, w, h) => draw the tower screen's default 512x1024 picture
 *   setup  async () => build film-only textures or props once assets are loaded
 *   shots  [[cutId, "set mood", stage(t, u, s)], ...] keyed by the plan's cut ids
 */
function createFilm(config) {
  STYLE = resolveStyle(config.style || PLAN.style);
  Object.assign(CAST, config.cast || {});
  Object.assign(CHESTS, config.chests || {});
  SHOT_BY_ID = Object.fromEntries(config.shots.map((s) => [s[0], s]));
  ORDER = PLAN.order.filter((id) => SHOT_BY_ID[id] || console.warn("no shot for cut", id));
  window.addEventListener("hf-seek", (e) => renderAt(e.detail.time));
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady[config.id || "film"] = build(config);
}

const PI = Math.PI;
export {
  THREE, PLAN, C, W, H, PI, clamp01, lerp, smooth, easeOut, backOut, mulberry32, v3,
  scene, overlay, camera, renderer, canvasTex, windowTex, numberTex, drawFace, CHESTS, CAST,
  A, crowd, put, WALK, CROWD_N, clipDur, SETS, townMats as mats,
  ROOM, FOREST, HOUSE_Z, SHIP_X, SHIP_Z, R, F,
  board, car, ship, roomWindow, houseWindow, winTex,
  setStone, setPancakes, books, smoke, sparkle, beam, greenStar, glow, stars,
  setEnv, MOODS, cam, FITS, CLOTH_PATTERNS, shade, cloth, weave, sun, hemi, rim, fill, grade, bloom, crowdWalk, crowdRun, crowdArc, arcPos, setCar, setShip, shipBeam,
  createFilm,
};
