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
import { buildKitScene, PROPS as KIT_PROPS, PALETTES as KIT_PALETTES } from "./kit.js";
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
  pipstar: (g) => {
    g.fillStyle = "#2d6a5a"; g.beginPath(); g.arc(128, 114, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f7eed8"; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 18 : 38;
      g[i ? "lineTo" : "moveTo"](128 + Math.cos(a) * r, 114 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  },
  kaiwave: (g) => {
    g.strokeStyle = "#6fc4b2"; g.lineWidth = 13; g.lineCap = "round"; g.lineJoin = "round";
    for (const dy of [0, 30]) {
      g.beginPath();
      g.moveTo(64, 114 + dy); g.quadraticCurveTo(96, 94 + dy, 128, 114 + dy); g.quadraticCurveTo(160, 134 + dy, 192, 114 + dy);
      g.stroke();
    }
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

  // ---- series casts (core/series/*.json).
  // family series: Dad Bo, Mom Mira, kid Pip (narrator); the dog Biscuit is in DOGS below.
  // Cohesive warm household palette: pine-olive, terracotta, honey-gold, cream, walnut & slate denim.
  bo: { hair: "Bo", scale: 1.12, chest: "none", face: { brow: "#3d2618" }, fit: ["Long", "Jacket", "Belt"], cloth: { Shirt: ["plaid", "#264a3e"] },
    col: { Skin: "#e0ad82", Shirt: "#3b6e5c", Pants: "#544a42", Shoes: "#6e472b", Hair: "#4a2e1b", HairStreak: "#d6cfc7", Inner: "#f4ecd8", Trim: "#295043", Belt: "#5a3822", Acc: "#e5b650" } },
  mira: { hair: "Mira", scale: 1.03, chest: "none", face: { lashes: true, blush: true, brow: "#522b1e" }, fit: ["Long", "Collar", "Belt"],
    col: { Skin: "#ebbc94", Shirt: "#d96b4e", Pants: "#3b4d63", Shoes: "#f2ebe0", Hair: "#6b3222", HairStreak: "#b86b3e", Acc: "#f0b44c", Trim: "#f5ede0", Belt: "#5c3d2e" } },
  pip: { hair: "Pip", scale: 0.83, chest: "pipstar", face: { blush: true, brow: "#4a2c18" }, fit: ["Short", "Crew", "Shorts", "Pack"],
    col: { Skin: "#ebbc94", Shirt: "#e8a838", Pants: "#3d5a73", Shoes: "#d94e42", Hair: "#54331d", HairStreak: "#8f5a32", Trim: "#2d6a5a", Pack: "#d95b43", Acc: "#f5ede0" } },
  // lover series: Kai and Nova (narrator). Complementary ocean-teal/mint + blush-rose/plum couple palette.
  kai: { hair: "Kai", scale: 1.07, chest: "kaiwave", face: { brow: "#1d2233" }, fit: ["Long", "Hood"],
    col: { Skin: "#cf966b", Shirt: "#356d85", Pants: "#282e3d", Shoes: "#eef3f6", Sole: "#6fc4b2", Hair: "#1c2233", HairStreak: "#5f88a8", Trim: "#6fc4b2", Acc: "#6fc4b2" } },
  nova: { hair: "Nova", scale: 0.99, chest: "none", face: { lashes: true, blush: true, brow: "#331c2e" }, fit: ["Long", "Scarf", "Skirt"],
    col: { Skin: "#f3c9a4", Shirt: "#e5b3a8", Pants: "#3b2338", Skirt: "#5b3254", Shoes: "#c94c65", Hair: "#2e1b30", HairStreak: "#b55d7a", Acc: "#e05a72", Trim: "#d6948a" } },
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
    // three.js names extra primitives "<mesh>_1", "<mesh>_2"; match the style name exactly
    if (o.name.startsWith("M_Hair_")) o.visible = o.name.replace(/_\d+$/, "") === "M_Hair_" + def.hair;
    if (o.name.startsWith("M_Fit_")) o.visible = fit.has(o.name.split("_")[2]);
    const fix = (m) => {
      if (m.name === "Face" || m.name === "Chest") {
        const nm = new THREE.MeshStandardMaterial({
          map: m.name === "Face" ? faces.neutral : chestTex, transparent: true, alphaTest: 0.04,
          roughness: m.name === "Face" ? STYLE.faceRoughness : 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        });
        nm.name = m.name;
        if (m.name === "Face" && def.face && def.face.shade) { // a shadow's eyes glow
          nm.emissive.set("#ffffff"); nm.emissiveMap = faces.neutral; nm.emissiveIntensity = 1.4;
        }
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
    face(expr) { faceMat.map = faces[expr]; if (faceMat.emissiveMap) faceMat.emissiveMap = faces[expr]; return self; },
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

// -------------------------------------------------------------------- dogs
// Four-legged actors from the style's dog.glb, with the same place / pose / face / number API as
// people, so put(A.biscuit, ...) works. Restyle a dog here: scale, ears ("Floppy" | "Pointy",
// more in core/styles/roblox/build.py), col (Fur, Patch = ears and tail tip, Paw = paws, snout and belly,
// Nose, Collar, Tag) and face (eye, brow, tongue colours).
const DOGS = {
  biscuit: { scale: 1.0, ears: "Floppy",
    col: { Fur: "#e0a458", Patch: "#7a4424", Paw: "#f6ead5", Nose: "#241916", Collar: "#2b8a78", Tag: "#f5c542" },
    face: { eye: "#1e1614", brow: "#5c3318", tongue: "#f26b7a" } },
};
const DOG_CLIPS = ["Idle", "Walk", "Run", "Sit", "Bark", "Beg", "Sleep"];
const DOG_FACES = ["neutral", "happy", "sad", "shock", "sleep"];
/** dog face in a 256 space: eyes and brows in the top 60 % (head front), mouth below (snout front) */
function drawDogFace(g, expr, o = {}) {
  const eyeC = o.eye || "#1b1820", brow = o.brow || "#5a3a22", tongue = o.tongue || "#ff7a8a", ink = "#2a1418";
  const ey = 84, lx = 78, rx = 178;
  const eye = (x, y, a, b) => {
    g.fillStyle = eyeC; g.beginPath(); g.ellipse(x, y, a, b, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(x - a * 0.3, y - b * 0.35, a * 0.38, 0, Math.PI * 2); g.fill();
  };
  const line = (pts, w, c = ink) => {
    g.strokeStyle = c; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  // mouth area: x 64..192, y 154..256 (the snout front)
  if (expr === "shock") {
    eye(lx, ey, 22, 28); eye(rx, ey, 22, 28);
    line([[lx - 22, ey - 44], [lx + 18, ey - 52]], 8, brow); line([[rx - 18, ey - 52], [rx + 22, ey - 44]], 8, brow);
    g.fillStyle = "#3a1220"; g.beginPath(); g.ellipse(128, 214, 18, 24, 0, 0, Math.PI * 2); g.fill();
  } else if (expr === "sad") {
    eye(lx, ey + 6, 16, 20); eye(rx, ey + 6, 16, 20);
    line([[lx - 22, ey - 18], [lx + 18, ey - 36]], 8, brow); line([[rx - 18, ey - 36], [rx + 22, ey - 18]], 8, brow);
    line([[100, 222], [128, 206], [156, 222]], 7);
  } else if (expr === "happy") {
    line([[lx - 20, ey + 6], [lx, ey - 12], [lx + 20, ey + 6]], 10, eyeC); line([[rx - 20, ey + 6], [rx, ey - 12], [rx + 20, ey + 6]], 10, eyeC);
    line([[96, 190], [112, 204], [128, 192], [144, 204], [160, 190]], 7);
    g.fillStyle = tongue; g.beginPath(); g.roundRect(114, 200, 28, 44, 14); g.fill();
  } else if (expr === "sleep") {
    line([[lx - 20, ey], [lx, ey + 10], [lx + 20, ey]], 8, eyeC); line([[rx - 20, ey], [rx, ey + 10], [rx + 20, ey]], 8, eyeC);
    line([[108, 204], [128, 212], [148, 204]], 6);
  } else {
    eye(lx, ey, 17, 22); eye(rx, ey, 17, 22);
    line([[lx - 18, ey - 36], [lx + 16, ey - 40]], 7, brow); line([[rx - 16, ey - 40], [rx + 18, ey - 36]], 7, brow);
    line([[100, 196], [114, 208], [128, 198], [142, 208], [156, 196]], 7);
  }
}
const dogDur = {};
function makeDog(base, clips, def) {
  const root = new THREE.Group();
  const model = cloneSkinned(base);
  model.scale.setScalar(def.scale || 1);
  root.add(model);
  const faces = Object.fromEntries(DOG_FACES.map((e) => [e, canvasTex(512, 512, (g) => { g.scale(2, 2); drawDogFace(g, e, def.face || {}); })]));
  const col = { Fur: "#d9a066", Patch: "#8a5a32", Paw: "#f3e2c7", Nose: "#2a1e1a", Collar: "#d8463f", Tag: "#ffd23c", ...def.col };
  const rough = { Fur: 0.9, Patch: 0.9, Paw: 0.9, Nose: 0.35, Collar: 0.6, Tag: 0.3 };
  let faceMat;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.name.startsWith("D_Ears_")) o.visible = o.name.replace(/_\d+$/, "") === "D_Ears_" + (def.ears || "Floppy");
    const fix = (m) => {
      if (m.name === "Face") {
        faceMat = new THREE.MeshStandardMaterial({ map: faces.neutral, transparent: true, alphaTest: 0.04, roughness: 0.9,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        faceMat.name = "Face";
        return faceMat;
      }
      const nm = m.clone();
      if (col[m.name]) nm.color.set(col[m.name]);
      nm.roughness = rough[m.name] ?? 0.85; nm.metalness = m.name === "Tag" ? 0.4 : 0;
      return nm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    const decal = o.name.startsWith("D_Face");
    o.castShadow = !decal; o.receiveShadow = !decal;
  });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of clips) { actions[clip.name] = mixer.clipAction(clip); actions[clip.name].play(); }
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex("0", "#ffffff"), fog: false, depthWrite: false, toneMapped: false }));
  const headY = 3.0 * (def.scale || 1);
  badge.visible = false;
  overlay.add(badge);
  scene.add(root);
  const self = {
    root, def, dog: true,
    /** blend up to two dog clips (DOG_CLIPS); times are in seconds and loop */
    pose(a, ta, b = null, wb = 0, tb = ta) {
      for (const k in actions) actions[k].setEffectiveWeight(0);
      const set = (name, time, w) => {
        if (!actions[name]) throw new Error(`dog clip "${name}" does not exist (${DOG_CLIPS.join(", ")})`);
        const d = dogDur[name];
        actions[name].time = ((time % d) + d) % d;
        actions[name].setEffectiveWeight(w);
      };
      set(a, ta, 1 - wb);
      if (b && wb > 0) set(b, tb, wb);
      mixer.update(0);
      return self;
    },
    /** neutral, happy, sad, shock, sleep (other human faces fall back to the nearest) */
    face(expr) {
      const alias = { smug: "happy", angry: "shock" };
      faceMat.map = faces[expr] || faces[alias[expr]] || faces.neutral;
      return self;
    },
    place(x, z, ry = 0, y = 0, size = 1) {
      root.visible = true; root.position.set(x, y, z); root.rotation.set(0, ry, 0); root.scale.setScalar(size);
      return self;
    },
    number(text, color = "#ffffff", s = 1, dx = 0, dy = 0) {
      badge.visible = text !== null;
      if (text === null) return self;
      badge.material.map = numberTex(String(text), color);
      badge.scale.set(2.0 * s, 1.25 * s, 1);
      badge.position.set(root.position.x + dx, root.position.y + headY + 1.0 + dy, root.position.z);
      return self;
    },
  };
  return self;
}

// ------------------------------------------------------------ sets and props
const SETS = {};          // town, house, room, forest, highway, home, cafe
let board, boardTex0, car, carPaint, ship, shipMats = {}, roomWindow, houseWindow, winTex = {};
let highwayScroll, highwaySign, highwaySignTex0, roadCar, roadCarPaint, roadCarRoof, roadCarLuggage, roadCarWheels = [];
let steeringWheel, stereo, stereoTex0, roadCarHeadMat, cabinLight, headLight, stereoGlow = null;
const ROOM = v3(300, 0, 0), FOREST = v3(-300, 0, 0), HIGHWAY = v3(600, 0, 0), HOUSE_Z = 64, SHIP_X = 0, SHIP_Z = 18;
const R = (x, y, z) => v3(ROOM.x + x, y, z);
const F = (x, y, z) => v3(FOREST.x + x, y, z);
const HW = (x, y, z) => v3(HIGHWAY.x + x, y, z);
const ROAD_SEATS = {
  driver: [2.55, 2.05, 0.8],
  passenger: [-2.55, 2.05, 0.8],
  backL: [1.85, 2.55, -3.5],
  backR: [-1.85, 2.55, -3.5],
  backC: [0, 2.55, -3.5],
  lean: [0, 2.55, -1.6],
};

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
  for (const k in setLights) for (const [l, d, nn] of setLights[k]) l.intensity = set === k ? lerp(d, nn, env.n) : 0;
  for (const k in setGlows) for (const [m, d, nn] of setGlows[k]) m.emissiveIntensity = lerp(d, nn, env.n);
  if (cabinLight) {
    if (!roadCar.visible) { cabinLight.intensity = 0; }
    else if (stereoGlow) { cabinLight.color.set(stereoGlow.color); cabinLight.intensity = stereoGlow.power; }
    else { cabinLight.color.set("#ffe4be"); cabinLight.intensity = 2.5 + 11 * env.n; }
  }
  if (headLight) {
    const hl = roadCar.visible ? Math.max(roadCar.userData.headlights || 0, clamp01((env.n - 0.2) / 0.5)) : 0;
    headLight.intensity = 55 * hl;
    if (roadCarHeadMat) roadCarHeadMat.emissiveIntensity = 0.4 + 2.4 * hl;
  }
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

// ------------------------------------------------ highway set & family road car
const HW_PERIOD = 40;
/** box with 1-stud UVs so procedural textures from textures.js tile cleanly without stretching */
function studBox(w, h, d, m, shadow = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [sx, sy] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    }
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  return mesh;
}
function stdMat(name, color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  m.name = name;
  dress(m);
  townMats[name] = m;
  return m;
}
const stereoTex = (draw) => canvasTex(512, 256, draw, true);
const highwaySignTex = (draw) => canvasTex(512, 256, draw, true);
const defaultStereo = (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#101a38"); grad.addColorStop(1, "#070b18");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#2ec4b6"; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = "#8fd3ff"; g.font = "700 34px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("ROAD TRIP RADIO", w / 2, 76);
  g.fillStyle = "#ffe44a"; g.font = "700 54px Fredoka, Arial Black, sans-serif";
  g.fillText("PLAYLIST READY", w / 2, 152);
};
const defaultHighwaySign = (g, w, h) => {
  g.fillStyle = "#176b43"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#f6f1e7"; g.lineWidth = 14; g.strokeRect(16, 16, w - 32, h - 32);
  g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "700 52px Fredoka, Arial Black, sans-serif";
  g.fillText("RED ROCK CANYON", w / 2, 92);
  g.fillStyle = "#ffe44a"; g.font = "700 44px Fredoka, Arial Black, sans-serif";
  g.fillText("NEXT 30 MILES  ↑", w / 2, 174);
};

function buildHighwaySet() {
  const root = new THREE.Group();
  root.position.copy(HIGHWAY);
  const add = (parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh;
  };
  const asphalt = stdMat("HighwayAsphalt", "#4d4954");
  const shoulder = stdMat("HighwayShoulder", "#b99a74");
  const desert = stdMat("DesertGround", "#cfa472");
  const mesaA = stdMat("MesaRock", "#bc6a4b");
  const mesaB = stdMat("MesaRockB", "#9f5542"); dress(Object.assign(mesaB, { name: "MesaRock" }));
  const mesaC = stdMat("MesaRockC", "#cc8358"); dress(Object.assign(mesaC, { name: "MesaRock" }));
  const whiteLine = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.85 });
  const dashMat = new THREE.MeshStandardMaterial({ color: "#f5c842", roughness: 0.8 });
  const railMat = stdMat("RoadChrome", "#c4cad4");
  const postMat = stdMat("RoadWood", "#6b4a33");
  const refMat = new THREE.MeshStandardMaterial({ color: "#ff5c48", emissive: "#ff5c48", emissiveIntensity: 0.55, roughness: 0.4 });
  const cactusMat = stdMat("Cactus", "#3e7d4a");
  const scrubMat = stdMat("CactusScrub", "#6c8c4c"); dress(Object.assign(scrubMat, { name: "Cactus" }));
  const rockMat = stdMat("HighwayRock", "#8f6f58"); dress(Object.assign(rockMat, { name: "MesaRock" }));

  // static roadbed and valley floor
  add(root, studBox(560, 0.6, 560, desert, false), 0, -0.45, 0);
  add(root, studBox(24, 0.24, 520, asphalt, false), 0, -0.12, 0);
  for (const sx of [-1, 1]) {
    add(root, studBox(9, 0.22, 520, shoulder, false), sx * 16.5, -0.14, 0);
    add(root, studBox(0.45, 0.04, 520, whiteLine, false), sx * 10.8, 0.015, 0);
  }
  // distant canyon mesas along both sides and framing both horizons with a pass at x = 0
  const mr = mulberry32(404);
  const mesas = [mesaA, mesaB, mesaC];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      const z = -220 + i * 48 + (mr() - 0.5) * 16;
      const dist = 78 + mr() * 75;
      const w = 28 + mr() * 34, d = 26 + mr() * 32, h = 18 + mr() * 34;
      const m = mesas[i % mesas.length];
      add(root, studBox(w, h, d, m), sx * dist, h / 2 - 0.5, z);
      add(root, studBox(w * 0.62, h * 0.42, d * 0.64, m), sx * (dist + 3), h + h * 0.21 - 0.5, z);
    }
  }
  for (const sz of [-1, 1]) {
    for (const [cx, w, h, d, mi] of [
      [-68, 72, 46, 44, 0], [-28, 30, 22, 34, 2], [68, 74, 50, 44, 1], [30, 32, 24, 34, 0],
      [-120, 68, 38, 48, 1], [122, 68, 40, 48, 2],
    ]) {
      add(root, studBox(w, h, d, mesas[mi]), cx, h / 2 - 0.5, sz * 218);
      add(root, studBox(w * 0.55, h * 0.35, d * 0.6, mesas[(mi + 1) % 3]), cx, h + h * 0.17 - 0.5, sz * 218);
    }
  }

  // scrolling layer: dashes, guardrails, utility poles, cacti, boulders, mile markers
  highwayScroll = new THREE.Group();
  root.add(highwayScroll);
  const sr = mulberry32(808);
  const tileItems = [];
  for (let i = 0; i < 8; i++) {
    const sx = i % 2 ? 1 : -1;
    tileItems.push({
      kind: i % 3 === 0 ? "cactus" : i % 3 === 1 ? "rock" : "scrub",
      x: sx * (22 + sr() * 36), z: (i / 8) * HW_PERIOD + sr() * 3,
      k: 0.8 + sr() * 0.75, rot: sr() * Math.PI,
    });
  }
  for (let tile = -6; tile <= 6; tile++) {
    const z0 = tile * HW_PERIOD;
    // yellow center dashes (two per 40-stud period)
    add(highwayScroll, studBox(0.42, 0.04, 7.6, dashMat, false), 0, 0.02, z0 + 8);
    add(highwayScroll, studBox(0.42, 0.04, 7.6, dashMat, false), 0, 0.02, z0 + 28);
    // guardrails and posts on both shoulders
    for (const sx of [-1, 1]) {
      add(highwayScroll, studBox(0.32, 0.55, HW_PERIOD, railMat), sx * 13.8, 1.75, z0 + HW_PERIOD / 2);
      for (let p = 0; p < HW_PERIOD; p += 10) {
        add(highwayScroll, studBox(0.45, 2.2, 0.45, postMat), sx * 14.1, 1.0, z0 + p);
        if (p % 20 === 0) add(highwayScroll, new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.36), refMat), sx * 13.58, 1.75, z0 + p);
      }
    }
    // utility pole on right side
    add(highwayScroll, studBox(0.65, 14.5, 0.65, postMat), 20.5, 7.1, z0 + 16);
    add(highwayScroll, studBox(4.8, 0.4, 0.4, postMat), 20.5, 13.4, z0 + 16);
    // roadside cacti, rocks and desert scrub
    for (const it of tileItems) {
      const x = it.x, z = z0 + it.z, k = it.k;
      if (it.kind === "cactus") {
        add(highwayScroll, studBox(1.1 * k, 5.4 * k, 1.1 * k, cactusMat), x, 2.6 * k, z, 0, it.rot);
        add(highwayScroll, studBox(1.6 * k, 0.8 * k, 0.8 * k, cactusMat), x + 1.1 * k, 3.0 * k, z, 0, it.rot);
        add(highwayScroll, studBox(0.8 * k, 2.2 * k, 0.8 * k, cactusMat), x + 1.6 * k, 4.1 * k, z, 0, it.rot);
        add(highwayScroll, studBox(1.4 * k, 0.8 * k, 0.8 * k, cactusMat), x - 1.0 * k, 2.3 * k, z, 0, it.rot);
        add(highwayScroll, studBox(0.8 * k, 1.9 * k, 0.8 * k, cactusMat), x - 1.45 * k, 3.2 * k, z, 0, it.rot);
      } else if (it.kind === "rock") {
        add(highwayScroll, studBox(2.8 * k, 1.9 * k, 2.4 * k, rockMat), x, 0.85 * k, z, 0, it.rot);
        add(highwayScroll, studBox(1.7 * k, 1.2 * k, 1.6 * k, rockMat), x + 1.4 * k, 0.5 * k, z + 0.8 * k, 0, it.rot + 0.5);
      } else {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 * k, 1), scrubMat);
        b.scale.set(1.2, 0.75, 1.1); b.castShadow = true; b.receiveShadow = true;
        add(highwayScroll, b, x, 0.75 * k, z);
      }
    }
  }

  // roadside cantilever highway sign (customizable texture)
  const signGroup = new THREE.Group();
  signGroup.position.set(0, 0, 56);
  const poleM = stdMat("SignPole", "#6e7582");
  const signBack = new THREE.MeshStandardMaterial({ color: "#1d5438", roughness: 0.75 });
  add(signGroup, studBox(0.85, 12.6, 0.85, poleM), 15.2, 6.2, 0);
  add(signGroup, studBox(11.8, 0.6, 0.6, poleM), 9.6, 11.4, 0);
  add(signGroup, studBox(10.6, 5.4, 0.35, signBack), 8.2, 10.6, -0.45);
  highwaySignTex0 = highwaySignTex(defaultHighwaySign);
  highwaySign = new THREE.Mesh(
    new THREE.PlaneGeometry(10.2, 5.0),
    new THREE.MeshBasicMaterial({ map: highwaySignTex0, fog: false }),
  );
  highwaySign.position.set(8.2, 10.6, -0.65);
  highwaySign.rotation.y = Math.PI; // faces -Z toward oncoming camera/driver
  signGroup.add(highwaySign);
  root.userData.signGroup = signGroup;
  root.add(signGroup);

  SETS.highway = root;
  scene.add(root);
}

function buildRoadCar() {
  const g = new THREE.Group();
  const add = (parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh;
  };
  roadCarPaint = stdMat("RoadCarPaint", "#2a9d8f");
  const chrome = stdMat("RoadChrome", "#d2d7e0");
  const dark = new THREE.MeshStandardMaterial({ color: "#232632", roughness: 0.72, metalness: 0.12 });
  const dash = stdMat("DashMat", "#2d3140");
  const seatMat = stdMat("SeatFabric", "#7a5c49");
  const seatTrim = stdMat("SeatTrim", "#5c4335"); dress(Object.assign(seatTrim, { name: "SeatFabric" }));
  const tireMat = new THREE.MeshStandardMaterial({ color: "#1d1e24", roughness: 0.9 });
  roadCarHeadMat = new THREE.MeshStandardMaterial({ color: "#fff4cc", emissive: "#ffe49e", emissiveIntensity: 0.5, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: "#ff4438", emissive: "#ff2e22", emissiveIntensity: 0.9, roughness: 0.35 });

  // floor pan & lower chassis
  add(g, studBox(10.0, 0.45, 16.8, dark), 0, 1.25, 0.2);
  // side door panels (open windows above y = 3.55 so characters are clearly visible with no transparent AO boxes)
  for (const sx of [-1, 1]) {
    add(g, studBox(0.5, 2.15, 13.0, roadCarPaint), sx * 5.0, 2.5, -1.7);
    add(g, studBox(0.16, 0.24, 13.2, chrome), sx * 5.26, 2.55, -1.7);
    add(g, studBox(0.24, 0.22, 0.9, chrome), sx * 5.28, 3.15, 0.5);
    add(g, studBox(0.24, 0.22, 0.9, chrome), sx * 5.28, 3.15, -3.5);
    // side mirrors
    add(g, studBox(0.85, 0.55, 0.45, roadCarPaint), sx * 5.6, 3.85, 4.15);
    // sleek window pillars (A, B, C, D)
    for (const pz of [4.55, -0.4, -4.75, -8.0]) {
      add(g, studBox(0.32, 3.9, 0.38, pz === 4.55 || pz === -8.0 ? roadCarPaint : dark), sx * 4.92, 5.5, pz);
    }
  }
  // top window frame rails & rearview mirror
  for (const sx of [-1, 1]) add(g, studBox(0.36, 0.32, 12.9, roadCarPaint), sx * 4.92, 7.45, -1.72);
  add(g, studBox(10.1, 0.34, 0.42, roadCarPaint), 0, 7.45, 4.55);
  add(g, studBox(10.1, 0.34, 0.42, roadCarPaint), 0, 7.45, -8.0);
  add(g, studBox(0.16, 0.55, 0.16, dark), 0, 7.05, 4.25);
  add(g, studBox(1.85, 0.52, 0.16, dark), 0, 6.72, 4.15);

  // front hood, grille, bumpers, headlights & rear tailgate
  add(g, studBox(10.1, 2.3, 4.2, roadCarPaint), 0, 2.6, 6.85);
  add(g, studBox(9.2, 0.35, 3.6, roadCarPaint), 0, 3.82, 6.75);
  add(g, studBox(5.2, 1.15, 0.25, dark), 0, 2.55, 8.95);
  for (const gy of [2.25, 2.55, 2.85]) add(g, studBox(4.8, 0.1, 0.32, chrome), 0, gy, 9.02);
  add(g, studBox(10.5, 0.65, 0.65, chrome), 0, 1.55, 9.12);
  add(g, studBox(10.5, 0.65, 0.65, chrome), 0, 1.55, -8.52);
  add(g, studBox(10.0, 2.3, 0.55, roadCarPaint), 0, 2.6, -8.15);
  for (const sx of [-1, 1]) {
    add(g, new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.25), roadCarHeadMat), sx * 3.6, 2.75, 8.98);
    add(g, new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 0.25), tailMat), sx * 3.8, 2.8, -8.45);
  }

  // 4 spinning blocky wheels
  roadCarWheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [5.4, -5.2]) {
      const w = new THREE.Group();
      w.position.set(sx * 5.2, 1.45, sz);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 1.15, 16), tireMat);
      tire.rotation.z = Math.PI / 2; tire.castShadow = true; tire.receiveShadow = true;
      w.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.22, 12), chrome);
      hub.rotation.z = Math.PI / 2; w.add(hub);
      // spoke cross so wheel spin reads clearly
      add(w, new THREE.Mesh(new THREE.BoxGeometry(1.26, 1.25, 0.22), dark), 0, 0, 0);
      add(w, new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.22, 1.25), dark), 0, 0, 0);
      g.add(w);
      roadCarWheels.push(w);
    }
  }

  // roof & strapped luggage (toggleable for top-down interior angles)
  roadCarRoof = new THREE.Group();
  add(roadCarRoof, studBox(10.2, 0.36, 12.8, roadCarPaint), 0, 7.62, -1.72);
  for (const sx of [-1, 1]) add(roadCarRoof, studBox(0.24, 0.24, 10.6, chrome), sx * 4.1, 7.95, -1.8);
  roadCarLuggage = new THREE.Group();
  const bag1 = stdMat("LuggageRed", "#d8463f"); dress(Object.assign(bag1, { name: "Luggage" }));
  const bag2 = stdMat("LuggageGold", "#e9c46a"); dress(Object.assign(bag2, { name: "Luggage" }));
  const bag3 = stdMat("LuggageNavy", "#3d5a80"); dress(Object.assign(bag3, { name: "Luggage" }));
  add(roadCarLuggage, studBox(3.8, 1.35, 3.0, bag1), -1.6, 8.48, -2.6, 0, 0.08);
  add(roadCarLuggage, studBox(3.1, 1.15, 2.5, bag2), 1.9, 8.38, -2.2, 0, -0.12);
  add(roadCarLuggage, studBox(2.9, 0.95, 2.2, bag3), -0.3, 9.6, -2.5, 0, 0.04);
  for (const sz of [-3.3, -1.8]) add(roadCarLuggage, new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.12, 0.18), dark), 0, 9.18, sz);
  roadCarRoof.add(roadCarLuggage);
  g.add(roadCarRoof);

  // dashboard, steering wheel, center console & playlist stereo screen
  add(g, studBox(9.6, 1.35, 1.35, dash), 0, 3.1, 4.12);
  add(g, studBox(9.6, 0.24, 1.55, dark), 0, 3.82, 4.15);
  // driver speedometer cluster
  add(g, new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.65, 0.14), dark), 2.55, 3.45, 3.42);
  const dialMat = new THREE.MeshBasicMaterial({ color: "#7fe6ff" });
  add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), dialMat), 2.95, 3.45, 3.34, 0, Math.PI);
  add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), dialMat), 2.15, 3.45, 3.34, 0, Math.PI);
  // steering column + steering wheel at driver side (+X)
  add(g, new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.85), dark), 2.55, 3.72, 3.35, -0.32);
  steeringWheel = new THREE.Group();
  steeringWheel.position.set(2.55, 3.85, 2.98);
  steeringWheel.rotation.x = -0.35;
  add(steeringWheel, new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12), dark), 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(steeringWheel, new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.22), dark), Math.cos(a) * 0.92, Math.sin(a) * 0.92, 0, 0, 0, a + Math.PI / 2);
  }
  add(steeringWheel, new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.16), chrome), 0, 0, 0);
  add(steeringWheel, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.16), chrome), 0, -0.45, 0);
  g.add(steeringWheel);

  // center console + stereo playlist screen (facing -Z toward driver/passengers)
  add(g, studBox(3.1, 2.55, 1.0, dark), 0, 2.88, 3.98);
  add(g, new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.48, 0.14), chrome), 0, 3.35, 3.42);
  stereoTex0 = stereoTex(defaultStereo);
  stereo = new THREE.Mesh(
    new THREE.PlaneGeometry(2.55, 1.28),
    new THREE.MeshBasicMaterial({ map: stereoTex0, fog: false }),
  );
  stereo.position.set(0, 3.35, 3.34);
  stereo.rotation.y = Math.PI;
  g.add(stereo);
  // chunky knobs and 4 colorful playlist preset buttons below stereo
  for (const sx of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.22, 12), chrome);
    k.rotation.x = Math.PI / 2; add(g, k, sx * 1.15, 2.42, 3.37);
  }
  for (const [i, col] of ["#2ec4b6", "#f2b632", "#9b6bff", "#ff595e"].entries()) {
    const bm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.4 });
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.16), bm), -0.66 + i * 0.44, 2.42, 3.40);
  }
  // gear shifter between front seats
  add(g, studBox(1.5, 0.75, 2.8, dark), 0, 1.8, 1.9);
  add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.95, 8), chrome), 0.35, 2.55, 2.45, 0.18);
  add(g, new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), dark), 0.35, 3.02, 2.54);

  // front bucket seats (+X driver, -X passenger) & raised back bench (stadium seating for clear visibility)
  for (const sx of [-1, 1]) {
    add(g, studBox(3.1, 0.6, 2.8, seatMat), sx * 2.55, 1.75, 0.8);
    add(g, studBox(2.9, 2.35, 0.52, seatTrim), sx * 2.55, 3.22, -0.45, -0.1);
  }
  add(g, studBox(8.8, 0.85, 3.0, seatMat), 0, 2.12, -3.7);
  add(g, studBox(8.8, 2.65, 0.55, seatTrim), 0, 3.85, -5.15, -0.08);

  // cabin fill light & night headlights attached to the car
  cabinLight = new THREE.PointLight("#ffe4be", 0, 18, 1.8);
  cabinLight.position.set(0, 5.6, 2.6);
  g.add(cabinLight);
  headLight = new THREE.SpotLight("#fff2cc", 0, 95, 0.75, 0.7, 1.2);
  headLight.position.set(0, 3.0, 9.2);
  headLight.target.position.set(0, 0, 44);
  g.add(headLight, headLight.target);

  roadCar = g;
  roadCar.visible = false;
  scene.add(roadCar);
}

/** scroll the highway scenery and optionally customize/position the roadside highway sign */
function setHighway(t = 0, { speed = 0, signZ = 56, signTex = highwaySignTex0, showSign = true } = {}) {
  if (!highwayScroll) return;
  const off = ((-(t * speed)) % HW_PERIOD + HW_PERIOD) % HW_PERIOD;
  highwayScroll.position.z = off - HW_PERIOD / 2;
  const sg = SETS.highway.userData.signGroup;
  sg.visible = showSign;
  sg.position.z = signZ;
  highwaySign.material.map = signTex || highwaySignTex0;
}
/** show and configure the family road-trip SUV cabin (faces +Z) */
function setRoadCar(x = HIGHWAY.x, z = 0, ry = 0, o = {}) {
  roadCar.visible = true;
  const bounce = o.bounce ? Math.sin((o.t || 0) * 14) * o.bounce : 0;
  roadCar.position.set(x, (o.y || 0) + bounce, z);
  roadCar.rotation.set(o.rx || 0, ry, o.rz || 0);
  roadCar.scale.setScalar(o.s || 1);
  roadCarPaint.color.set(o.color || "#2a9d8f");
  roadCarRoof.visible = o.roof !== false;
  roadCarLuggage.visible = o.luggage !== false;
  roadCar.userData.headlights = o.headlights || 0;
  const wheelSpin = ((o.t || 0) * (o.speed || 0)) / 1.45;
  for (const w of roadCarWheels) w.rotation.x = wheelSpin;
  steeringWheel.rotation.z = o.steer || 0;
}
/** place an actor into a seat of roadCar (driver, passenger, backL, backR, backC, lean) */
function seatInCar(actor, slot, clip, t, face, o = {}) {
  const [lx, ly, lz] = ROAD_SEATS[slot] || ROAD_SEATS.backL;
  const x = lx + (o.dx || 0), y = ly + (o.dy || 0), z = lz + (o.dz || 0);
  const s = roadCar.scale.x, cy = Math.cos(roadCar.rotation.y), sy = Math.sin(roadCar.rotation.y);
  const wx = roadCar.position.x + (x * cy + z * sy) * s;
  const wz = roadCar.position.z + (-x * sy + z * cy) * s;
  const wy = roadCar.position.y + y * s;
  actor.place(wx, wz, roadCar.rotation.y + (o.ry || 0), wy, (o.size || 1) * s)
    .pose(clip, t, o.clipB || null, o.wb || 0, o.tb ?? t)
    .face(face);
  return actor;
}
/** set the dashboard stereo screen texture and optional cabin glow color/power */
function setStereo(tex = stereoTex0, glowColor = null, glowPower = 0) {
  if (!stereo) return;
  stereo.material.map = tex || stereoTex0;
  stereoGlow = glowColor && glowPower > 0 ? { color: glowColor, power: glowPower } : null;
}

// ------------------------------------------------ home interior & cafe sets
// Purpose-built interiors laid out like a stage: the cast plays in front of the back wall
// (window, kitchen, counter) and cameras stand inside the room at z > 0 looking toward -Z,
// so faces read and there is depth behind everyone. Ceilings and walls cast no sun shadows,
// so daylight still fills the room; warm practical lights come up at dusk and night.
const HOME = v3(-600, 0, 0), CAFE = v3(900, 0, 0);
const HM = (x, y, z) => v3(HOME.x + x, y, z);
const CF = (x, y, z) => v3(CAFE.x + x, y, z);
const setLights = { home: [], cafe: [] }; // [light, day power, night power]
const setGlows = { home: [], cafe: [] };  // [material, day emissive, night emissive]
const setWindows = { home: [], cafe: [] };
let setWinTex = {}, homeTv, homeTvTex0, cafeMenu, cafeMenuTex0;
/** where people sit (local x, y, z, ry): HOME_SEATS.sofaL/sofaC/sofaR, chairs; CAFE_SEATS.left/right, stools */
const HOME_SEATS = {
  sofaL: [-16.2, 2.15, -14.6, 0], sofaC: [-12, 2.15, -14.6, 0], sofaR: [-7.8, 2.15, -14.6, 0],
  chairL: [10, 2.12, -9.5, 0], chairR: [15, 2.12, -9.5, 0], chairEndL: [6.3, 2.12, -6.5, Math.PI / 2], chairEndR: [18.7, 2.12, -6.5, -Math.PI / 2],
  bed: [-1.5, 0.75, -2, -0.7],
};
const CAFE_SEATS = {
  left: [-9.2, 2.08, -3.7, 0.22], right: [-4.8, 2.08, -3.7, -0.22],
  stoolL: [4.5, 3.25, -9.6, 0], stoolC: [9, 3.25, -9.6, 0], stoolR: [13.5, 3.25, -9.6, 0],
};

function surfMat(surface, color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  m.name = surface; dress(m); return m;
}
const plainMat = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
function glowMat(set, color, day, night) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: day, roughness: 0.4 });
  setGlows[set].push([m, day, night]); return m;
}
function practical(set, color, pos, day, night, dist = 40) {
  const l = new THREE.PointLight(color, 0, dist, 1.6);
  l.position.copy(pos); scene.add(l); setLights[set].push([l, day, night]); return l;
}
const put3 = (parent, mesh, x, y, z, ry = 0, rx = 0, rz = 0) => { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh; };
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const cyl = (rt, rb, h, m, seg = 20) => shadowy(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m));
const ball = (r, m, sx = 1, sy = 1, sz = 1) => { const b = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m)); b.scale.set(sx, sy, sz); return b; };
const noShadow = (m) => { m.castShadow = false; return m; };
const picture = (w, h, draw, mat = {}) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(512, Math.round(512 * h / w), draw, true), fog: false, ...mat }));

/** potted plant: k scales it, tall stretches the foliage */
function pottedPlant(parent, x, z, k, pot, leaves, seed, tall = 1) {
  const r = mulberry32(seed);
  put3(parent, cyl(0.95 * k, 0.72 * k, 1.7 * k, pot), x, 0.85 * k, z);
  put3(parent, cyl(0.86 * k, 0.86 * k, 0.12 * k, plainMat("#3b2a20", 1)), x, 1.68 * k, z);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39, rr = (0.3 + 0.6 * r()) * k, h = (2.2 + (i / 9) * 3.2 * tall) * k;
    put3(parent, ball((0.85 + 0.5 * r()) * k, leaves[i % leaves.length], 1.1, 0.8, 1.1), x + Math.cos(a) * rr, h, z + Math.sin(a) * rr, r() * 3);
  }
}
/** window backdrops: garden (home) and street (cafe) for day, dusk and night */
function backdropTex(kind, mood) {
  return canvasTex(512, 512, (g, w, h) => {
    const sky = { day: ["#6fa6e8", "#cfe6f7"], dusk: ["#5b4f9c", "#ffb27a"], night: ["#0d1638", "#2c3b78"] }[mood];
    const gr = g.createLinearGradient(0, 0, 0, h * 0.7);
    gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = mulberry32(kind === "garden" ? 5 : 9);
    if (mood === "night") { g.fillStyle = "#ffffff"; for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h * 0.45, 2, 2); g.fillStyle = "#f4f1dc"; g.beginPath(); g.arc(w * 0.78, h * 0.16, 26, 0, 7); g.fill(); }
    else if (mood === "day") { g.fillStyle = "rgba(255,255,255,0.85)"; for (const [cx, cy] of [[90, 90], [330, 60], [430, 150]]) for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + k * 22, cy + (k % 2) * 6, 34, 20, 0, 0, 7); g.fill(); } }
    else { g.fillStyle = "rgba(255,190,120,0.9)"; g.beginPath(); g.arc(w * 0.3, h * 0.55, 46, 0, 7); g.fill(); }
    const dim = mood === "day" ? 1 : mood === "dusk" ? 0.7 : 0.35;
    const sh = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) * dim | 0},${((n >> 8) & 255) * dim | 0},${(n & 255) * dim | 0})`; };
    if (kind === "garden") {
      g.fillStyle = sh("#7bb36a"); g.fillRect(0, h * 0.62, w, h);
      for (let i = 0; i < 7; i++) { g.fillStyle = sh(i % 2 ? "#4f8f4a" : "#3f7a40"); g.beginPath(); g.arc(i * 85 + 20, h * 0.58, 60 + r() * 30, 0, 7); g.fill(); }
      g.fillStyle = sh("#5a3c28"); for (let i = 0; i < 4; i++) g.fillRect(60 + i * 130, h * 0.6, 14, 60);
      g.fillStyle = sh("#f4efe6"); for (let x = 0; x < w; x += 34) { g.fillRect(x, h * 0.7, 20, 90); g.beginPath(); g.moveTo(x, h * 0.7); g.lineTo(x + 10, h * 0.67); g.lineTo(x + 20, h * 0.7); g.fill(); }
      g.fillRect(0, h * 0.74, w, 10); g.fillRect(0, h * 0.82, w, 10);
      g.fillStyle = sh("#86c072"); g.fillRect(0, h * 0.87, w, h);
      if (mood !== "day") { g.fillStyle = "#ffd27a"; g.fillRect(400, 250, 34, 30); }
    } else {
      const cols = ["#d98b5f", "#7aa0b8", "#e3c27a", "#9b6f8f", "#6f9a7a"];
      for (let i = 0; i < 5; i++) {
        const x = i * 108 - 10, top = h * (0.18 + r() * 0.12);
        g.fillStyle = sh(cols[i]); g.fillRect(x, top, 100, h);
        for (let wy = top + 24; wy < h * 0.6; wy += 52) for (let wx = x + 14; wx < x + 90; wx += 34) {
          g.fillStyle = mood === "day" ? "#cfe3f0" : (r() < 0.7 ? "#ffd58a" : "#3a3550"); g.fillRect(wx, wy, 20, 30);
        }
        g.fillStyle = mood === "day" ? sh("#2f3a46") : "#ffcf7a"; g.fillRect(x + 12, h * 0.66, 76, 60);
        g.fillStyle = sh(["#c8553d", "#2a9d8f", "#e9c46a", "#8a5a9a", "#3d5a80"][i]); g.fillRect(x + 6, h * 0.62, 88, 16);
      }
      g.fillStyle = sh("#8d8a86"); g.fillRect(0, h * 0.8, w, h);
      g.fillStyle = sh("#5c5a62"); g.fillRect(0, h * 0.88, w, h);
      g.strokeStyle = "rgba(60,50,40,0.8)"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h * 0.42); g.quadraticCurveTo(w / 2, h * 0.52, w, h * 0.42); g.stroke();
      for (let i = 0; i <= 16; i++) { const x = (i / 16) * w, y = h * 0.42 + Math.sin(Math.PI * i / 16) * h * 0.075; g.fillStyle = mood === "day" ? "#f5efd8" : "#ffe08a"; g.beginPath(); g.arc(x, y + 6, mood === "day" ? 4 : 7, 0, 7); g.fill(); }
      // a lamp post and a passing silhouette
      g.fillStyle = sh("#2c2f36"); g.fillRect(250, h * 0.5, 8, h * 0.4); g.fillRect(238, h * 0.5, 32, 10);
      if (mood !== "day") { g.fillStyle = "rgba(255,220,140,0.35)"; g.beginPath(); g.arc(254, h * 0.5 + 12, 40, 0, 7); g.fill(); }
    }
  }, true);
}
const tvTex = (draw) => canvasTex(512, 288, draw, true);
const menuTex = (draw) => canvasTex(512, 256, draw, true);
const defaultTv = (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#3a86c8"); gr.addColorStop(1, "#1d4f8a");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = "#7bc96f"; g.fillRect(0, h * 0.72, w, h);
  g.fillStyle = "#ffe44a"; g.beginPath(); g.arc(w * 0.82, h * 0.2, 30, 0, 7); g.fill();
  g.fillStyle = "#e0a050"; g.fillRect(170, 120, 150, 70); g.fillRect(290, 90, 60, 60); g.fillRect(185, 185, 24, 40); g.fillRect(285, 185, 24, 40);
  g.fillStyle = "#5a3520"; g.fillRect(330, 82, 22, 40);
  g.fillStyle = "#ffffff"; g.font = "700 40px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.fillText("PUPPY TV", w / 2, 56);
};
const defaultMenu = (g, w, h) => {
  g.fillStyle = "#1f2b26"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#e9dcc0"; g.lineWidth = 4; g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = "#ffd27a"; g.font = "700 40px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.fillText("MOON BEAN", w / 2, 56);
  g.font = "700 26px Fredoka, Arial Black, sans-serif"; g.fillStyle = "#f2ece0"; g.textAlign = "left";
  [["LATTE", "4"], ["MOCHA", "5"], ["CHAI", "4"], ["MUFFIN", "3"]].forEach(([a, b], i) => {
    const x = i < 2 ? 40 : 280, y = 120 + (i % 2) * 64; g.fillText(a, x, y); g.textAlign = "right"; g.fillText(b, x + 190, y); g.textAlign = "left";
  });
};

function buildHomeSet() {
  const root = new THREE.Group(); root.position.copy(HOME);
  const floor = surfMat("HomeFloor", "#c08c5c");
  const wallA = surfMat("HomeWall", "#f2dcc0"), wallB = surfMat("HomeWall", "#d6e3cf"), ceil = surfMat("HomeWall", "#f6efe4");
  const wood = surfMat("HomeWood", "#7d5136"), woodL = surfMat("HomeWood", "#c99868");
  const trim = plainMat("#fbf6ee", 0.6), dark = plainMat("#2a2d36", 0.45, 0.2), white = plainMat("#f4f1ea", 0.5);
  const sofa = surfMat("Sofa", "#4c7c8a"), sofaC = surfMat("Sofa", "#5d91a0");
  const pillowA = surfMat("Sofa", "#e8b04a"), pillowB = surfMat("Sofa", "#d9664f"), curtain = surfMat("Sofa", "#e0a548");
  const rugA = surfMat("HomeRug", "#a9483f"), rugB = surfMat("HomeRug", "#ead2ab");
  const leaves = [surfMat("HomeLeaf", "#4f8a4a"), surfMat("HomeLeaf", "#68a356"), surfMat("HomeLeaf", "#3d7543")];
  const pot = plainMat("#c4643f", 0.8), potW = plainMat("#ece6dc", 0.6), potB = plainMat("#3f5f7a", 0.6);
  const cab = surfMat("Cabinet", "#86a890"), counter = surfMat("Counter", "#f1ece4"), tile = surfMat("HomeTile", "#dcebf0");
  const steel = surfMat("Appliance", "#d9dee4"), chrome = surfMat("RoadChrome", "#cfd5de");
  const bedRim = surfMat("Sofa", "#b8443f"), bedIn = surfMat("Sofa", "#f2e3c6");
  const add = (mesh, x, y, z, ry, rx, rz) => put3(root, mesh, x, y, z, ry, rx, rz);

  // shell: floor, walls, front wall behind the cameras, ceiling and beams
  add(studBox(58, 0.5, 52, floor, false), 0, -0.25, 4);
  add(noShadow(studBox(30, 20, 1, wallA)), -13, 10, -20.5);
  add(noShadow(studBox(26, 20, 1, wallB)), 15, 10, -20.5);
  add(noShadow(studBox(1, 20, 52, wallA)), -28.5, 10, 4);
  add(noShadow(studBox(1, 20, 52, wallB)), 28.5, 10, 4);
  add(noShadow(studBox(58, 20, 1, wallA)), 0, 10, 30.5);
  add(noShadow(studBox(58, 1, 52, ceil)), 0, 20.5, 4);
  for (let z = -16; z <= 26; z += 8) add(noShadow(studBox(58, 0.8, 0.9, wood)), 0, 19.6, z);
  add(noShadow(studBox(56, 0.8, 0.35, trim)), 0, 0.4, -19.85);
  for (const sx of [-1, 1]) add(noShadow(studBox(0.35, 0.8, 50, trim)), sx * 27.85, 0.4, 4);
  add(noShadow(studBox(56, 0.5, 0.45, trim)), 0, 19.0, -19.8);

  // big living-room window with curtains (garden backdrop) and a small one over the sink
  const winMat = new THREE.MeshBasicMaterial({ fog: false });
  setWindows.home.push(winMat);
  const win = (x, y, w, h) => {
    add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), winMat), x, y, -19.92);
    add(noShadow(studBox(w + 1.2, 0.6, 0.5, trim)), x, y + h / 2 + 0.3, -19.75);
    add(noShadow(studBox(w + 1.2, 0.6, 0.5, trim)), x, y - h / 2 - 0.3, -19.75);
    for (const sx of [-1, 1]) add(noShadow(studBox(0.6, h, 0.5, trim)), x + sx * (w / 2 + 0.3), y, -19.75);
    add(noShadow(studBox(0.32, h, 0.3, trim)), x, y, -19.8);
    add(noShadow(studBox(w, 0.32, 0.3, trim)), x, y + h * 0.18, -19.8);
    add(studBox(w + 2, 0.4, 1.3, trim), x, y - h / 2 - 0.55, -19.4);
  };
  win(-12, 9.6, 14, 8.6);
  win(15, 9.8, 6.4, 4.6);
  for (const sx of [-1, 1]) add(studBox(2.6, 11.5, 0.6, curtain), -12 + sx * 8.7, 8.9, -19.4);
  add(noShadow(studBox(21, 0.25, 0.25, chrome)), -12, 14.7, -19.4);

  // living room: rugs, sofa, coffee table, armchair, lamp, tv, bookshelf, art
  add(studBox(20, 0.08, 13.5, rugA, false), -12, 0.04, -6.5);
  add(studBox(17.4, 0.1, 11, rugB, false), -12, 0.05, -6.5);
  add(studBox(14, 1.3, 4.6, sofa), -12, 0.85, -15.2);
  for (let i = 0; i < 3; i++) {
    add(studBox(4.1, 0.65, 3.7, sofaC), -12 + (i - 1) * 4.2, 1.83, -14.75);
    add(studBox(4.0, 2.5, 0.9, sofaC), -12 + (i - 1) * 4.2, 3.35, -16.1, 0, -0.1);
  }
  add(studBox(14, 3.6, 1.1, sofa), -12, 2.9, -17.0);
  for (const sx of [-1, 1]) add(studBox(1.2, 2.5, 4.6, sofa), -12 + sx * 6.4, 1.45, -15.2);
  for (const [sx, sz] of [[-6.6, -13.2], [6.6, -13.2], [-6.6, -17.2], [6.6, -17.2]]) add(studBox(0.5, 0.4, 0.5, wood), -12 + sx, 0.2, sz);
  add(studBox(1.8, 1.8, 0.55, pillowA), -17.2, 3.05, -15.5, 0.35, 0, 0.18);
  add(studBox(1.7, 1.7, 0.55, pillowB), -6.8, 3.0, -15.5, -0.35, 0, -0.18);
  // coffee table and what is on it
  add(studBox(7.5, 0.45, 3.8, woodL), -12, 1.75, -8.5);
  add(studBox(6.8, 0.2, 3.2, wood), -12, 0.55, -8.5);
  for (const [sx, sz] of [[-3.3, -1.5], [3.3, -1.5], [-3.3, 1.5], [3.3, 1.5]]) add(studBox(0.45, 1.6, 0.45, wood), -12 + sx, 0.8, -8.5 + sz);
  add(cyl(0.32, 0.28, 0.6, white), -10.2, 2.28, -8.0);
  add(studBox(1.8, 0.3, 1.3, plainMat("#2a9d8f")), -13.6, 2.13, -8.6, 0.2);
  add(studBox(1.6, 0.3, 1.2, plainMat("#e76f51")), -13.5, 2.43, -8.5, -0.1);
  add(cyl(0.9, 0.6, 0.5, potW), -11.6, 2.22, -9.2);
  for (const [dx, dz, c] of [[-0.3, 0, "#e94f37"], [0.3, 0.1, "#f2b632"], [0, -0.3, "#7cb342"]]) add(ball(0.35, plainMat(c, 0.5)), -11.6 + dx, 2.6, -9.2 + dz);
  // armchair angled toward the room
  {
    const g = new THREE.Group(); put3(root, g, -22.5, 0, -5, 1.0);
    put3(g, studBox(4.6, 1.3, 4.4, sofa), 0, 0.85, 0); put3(g, studBox(3.4, 0.6, 3.4, sofaC), 0, 1.8, 0.3);
    put3(g, studBox(4.6, 3.4, 1.0, sofa), 0, 2.8, -1.8); for (const sx of [-1, 1]) put3(g, studBox(0.9, 2.4, 4.4, sofa), sx * 2.15, 1.5, 0);
    put3(g, studBox(1.5, 1.5, 0.5, pillowB), 0, 3.0, -1.1, 0, -0.15);
  }
  // floor lamp and side table with a plant
  add(cyl(0.9, 1.0, 0.25, dark), -20.8, 0.13, -16.5);
  add(cyl(0.12, 0.12, 8.6, dark), -20.8, 4.4, -16.5);
  add(cyl(1.0, 1.5, 1.9, glowMat("home", "#ffd9a0", 0.15, 1.3)), -20.8, 9.2, -16.5);
  practical("home", "#ffc98a", HM(-20.8, 8.0, -15.0), 3, 34, 34);
  add(studBox(2.6, 2.4, 2.6, woodL), -3.4, 1.2, -16.2);
  pottedPlant(root, -3.4, -16.2, 0.55, potB, leaves, 3, 0.6);
  // the small plant sits on the table: lift the last 11 meshes by the table height
  for (const m of root.children.slice(-11)) m.position.y += 2.4;
  // tv on the left wall, facing the room
  add(studBox(2.6, 2.4, 11, wood), -26.9, 1.2, -4);
  add(studBox(0.5, 5.2, 8.8, dark), -27.5, 6.6, -4);
  homeTvTex0 = tvTex(defaultTv);
  homeTv = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 4.6), new THREE.MeshBasicMaterial({ map: homeTvTex0, fog: false }));
  add(homeTv, -27.2, 6.6, -4, Math.PI / 2);
  for (const dz of [-4.6, 4.6]) add(studBox(1.4, 1.8, 1.2, dark), -26.9, 3.3, -4 + dz);
  // bookshelf on the left wall, nearer the cameras
  {
    const r = mulberry32(61), bookCols = ["#e76f51", "#2a9d8f", "#e9c46a", "#264653", "#f4a261", "#8a5a9a", "#d6d0c4"];
    add(studBox(2.2, 12, 0.4, wood), -27, 6, 7.2); add(studBox(2.2, 12, 0.4, wood), -27, 6, 14.8);
    for (let s = 0; s < 5; s++) {
      const y = 0.3 + s * 2.85; add(studBox(2.2, 0.3, 7.6, wood), -27, y, 11);
      if (s === 4) break;
      let z = 7.7;
      while (z < 14.2) { const bw = 0.35 + r() * 0.35, bh = 1.6 + r() * 0.9; add(studBox(1.6, bh, bw, plainMat(bookCols[Math.floor(r() * 7)], 0.8)), -27.1, y + 0.15 + bh / 2, z + bw / 2); z += bw + 0.05; }
    }
  }
  // framed art between the zones and over the tv
  const art = (w, h, draw, x, y, z, ry = 0) => {
    add(studBox(w + 0.5, h + 0.5, 0.2, wood), x, y, z - (ry ? 0 : 0.05), ry);
    add(picture(w, h, draw), ry ? x + 0.12 : x, y, ry ? z : z + 0.08, ry);
  };
  art(3.2, 4.2, (g, w, h) => { g.fillStyle = "#f3e2c3"; g.fillRect(0, 0, w, h); g.fillStyle = "#e07a4f"; g.beginPath(); g.arc(w / 2, h * 0.42, 110, 0, 7); g.fill(); g.fillStyle = "#2a9d8f"; g.fillRect(0, h * 0.62, w, h); g.fillStyle = "#264653"; g.fillRect(0, h * 0.8, w, h); }, 0.6, 10.5, -19.95);
  art(2.4, 2.4, (g, w, h) => { g.fillStyle = "#264653"; g.fillRect(0, 0, w, h); g.fillStyle = "#e9c46a"; g.fillRect(90, 90, 330, 330); g.fillStyle = "#e76f51"; g.fillRect(170, 170, 170, 170); }, 0.6, 15.2, -19.95);
  art(6, 3, (g, w, h) => { g.fillStyle = "#e9e1d0"; g.fillRect(0, 0, w, h); ["#e76f51", "#2a9d8f", "#e9c46a", "#264653"].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(80 + i * 118, h / 2, 46, 0, 7); g.fill(); }); }, -27.85, 12.6, -4, Math.PI / 2);
  // dog bed, bowl and bone for Biscuit
  add(cyl(3.0, 3.1, 0.5, bedRim, 28), -1.5, 0.25, -2);
  const rim = shadowy(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.52, 10, 28), bedRim)); add(rim, -1.5, 0.68, -2, 0, Math.PI / 2);
  add(cyl(2.3, 2.3, 0.3, bedIn, 28), -1.5, 0.6, -2);
  add(cyl(0.8, 0.62, 0.5, plainMat("#d8463f", 0.4)), 2.4, 0.25, 0.4);
  add(cyl(0.62, 0.62, 0.06, plainMat("#8a5a3b", 0.9)), 2.4, 0.48, 0.4);
  add(studBox(1.4, 0.3, 0.35, white), 1.6, 0.18, 2.2, 0.5);
  for (const sx of [-1, 1]) add(ball(0.28, white), 1.6 + sx * 0.66 * Math.cos(0.5), 0.2, 2.2 - sx * 0.66 * Math.sin(0.5));

  // kitchen: cabinets, counter, tiles, stove, sink, uppers, fridge, clock
  add(studBox(17, 3.0, 3.2, cab), 13.5, 1.5, -18.3);
  add(studBox(17.6, 0.35, 3.7, counter), 13.5, 3.17, -18.1);
  add(noShadow(studBox(17, 4.2, 0.2, tile)), 13.5, 5.45, -19.9);
  for (let i = 0; i <= 6; i++) add(studBox(0.06, 2.6, 0.05, dark), 5 + i * 2.833, 1.6, -16.68);
  for (let i = 0; i < 6; i++) add(studBox(0.5, 0.14, 0.18, chrome), 6.4 + i * 2.833, 2.5, -16.62);
  add(studBox(3.4, 0.12, 2.6, dark), 8.6, 3.41, -18.1);
  for (const [dx, dz] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) add(cyl(0.5, 0.5, 0.06, plainMat("#555a66", 0.4, 0.5)), 8.6 + dx, 3.5, -18.1 + dz);
  add(studBox(3.0, 1.9, 0.08, dark), 8.6, 1.5, -16.66);
  add(studBox(2.4, 0.14, 0.2, chrome), 8.6, 2.6, -16.6);
  add(cyl(0.85, 0.85, 1.0, steel), 8.0, 4.0, -18.4);
  add(studBox(3.0, 0.08, 2.0, steel), 15, 3.36, -18.2);
  add(cyl(0.1, 0.1, 1.3, chrome), 15, 4.0, -19.2); add(studBox(0.2, 0.2, 1.0, chrome), 15, 4.6, -18.8);
  add(studBox(7.2, 3.4, 2.0, cab), 8, 9.8, -19.0); add(studBox(3.4, 3.4, 2.0, cab), 20.3, 9.8, -19.0);
  for (const x of [5.9, 10.1, 19.6]) add(studBox(0.14, 0.7, 0.18, chrome), x, 8.6, -17.95);
  add(studBox(1.6, 1.2, 1.2, plainMat("#d8463f", 0.35, 0.3)), 5.8, 3.95, -18.3);
  add(studBox(2.4, 0.15, 1.6, woodL), 11.6, 3.42, -17.8, 0.15);
  add(cyl(1.0, 0.7, 0.55, potW), 17.6, 3.62, -18.3);
  for (const [dx, c] of [[-0.35, "#f2b632"], [0.3, "#e94f37"], [0, "#7cb342"]]) add(ball(0.38, plainMat(c, 0.5)), 17.6 + dx, 4.0, -18.3);
  pottedPlant(root, 20.6, -18.4, 0.42, potW, leaves, 8, 0.5);
  for (const m of root.children.slice(-11)) m.position.y += 3.35;
  // fridge with magnets and a kid's drawing
  add(studBox(4.6, 8.8, 3.8, steel), 24.6, 4.4, -18.0);
  add(studBox(4.6, 0.06, 0.05, dark), 24.6, 6.0, -16.08);
  add(studBox(0.22, 1.5, 0.28, chrome), 22.75, 7.3, -15.95); add(studBox(0.22, 2.6, 0.28, chrome), 22.75, 3.9, -15.95);
  add(picture(1.8, 1.4, (g, w, h) => { g.fillStyle = "#fffdf6"; g.fillRect(0, 0, w, h); g.fillStyle = "#e0a050"; g.fillRect(150, 160, 200, 110); g.fillRect(330, 110, 90, 90); g.fillStyle = "#5a3520"; g.fillRect(400, 100, 28, 56); g.fillRect(160, 270, 26, 70); g.fillRect(310, 270, 26, 70); g.fillStyle = "#e94f37"; g.font = "700 64px Fredoka, Arial"; g.fillText("♥", 60, 110); }), 24.8, 4.2, -16.07);
  for (const [dx, dy, c] of [[-0.9, 0.75, "#e94f37"], [0.9, 0.75, "#2a9d8f"], [0.4, 3.4, "#f2b632"], [-0.6, 3.0, "#8a5a9a"]]) add(studBox(0.35, 0.35, 0.12, plainMat(c, 0.4)), 24.8 + dx, 4.2 + dy, -16.03);
  add(cyl(1.1, 1.1, 0.2, white, 28), 15, 14.6, -19.85, 0, Math.PI / 2);
  add(studBox(0.12, 0.8, 0.06, dark), 15, 14.9, -19.7); add(studBox(0.6, 0.1, 0.06, dark), 15.25, 14.6, -19.7);
  // dining table, chairs, plates and two pendant lamps
  add(studBox(10, 0.45, 5, woodL), 12.5, 2.85, -6.5);
  for (const [sx, sz] of [[-4.3, -2.0], [4.3, -2.0], [-4.3, 2.0], [4.3, 2.0]]) add(studBox(0.5, 2.65, 0.5, wood), 12.5 + sx, 1.32, -6.5 + sz);
  add(studBox(8.8, 0.04, 1.4, rugA, false), 12.5, 3.1, -6.5);
  for (const [px, pz] of [[10, -8.3], [15, -8.3], [8.3, -6.5], [16.7, -6.5]]) add(cyl(0.75, 0.6, 0.1, white), px, 3.12, pz);
  const chair = (x, z, ry) => {
    const g = new THREE.Group(); put3(root, g, x, 0, z, ry);
    put3(g, studBox(2.3, 0.35, 2.3, wood), 0, 1.95, 0);
    for (const [sx, sz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) put3(g, studBox(0.3, 1.8, 0.3, wood), sx, 0.9, sz);
    put3(g, studBox(2.3, 0.4, 0.3, wood), 0, 4.6, -1.0); for (const sx of [-0.9, 0, 0.9]) put3(g, studBox(0.25, 2.6, 0.25, wood), sx, 3.3, -1.0);
  };
  chair(10, -9.4, 0); chair(15, -9.4, 0); chair(6.4, -6.5, Math.PI / 2); chair(18.6, -6.5, -Math.PI / 2);
  for (const x of [10, 15]) {
    add(noShadow(cyl(0.05, 0.05, 5.6, dark, 6)), x, 17.6, -6.5);
    add(noShadow(cyl(0.5, 1.4, 1.2, plainMat("#2f5d55", 0.5))), x, 14.4, -6.5);
    add(noShadow(ball(0.42, glowMat("home", "#ffe2b0", 0.6, 2.4))), x, 13.75, -6.5);
  }
  practical("home", "#ffd19a", HM(12.5, 12.6, -6.5), 2, 26, 34);
  // plants in the corners and one near the cameras for foreground depth
  pottedPlant(root, -25.3, -17.6, 1.35, pot, leaves, 1, 1.2);
  pottedPlant(root, 0.9, -17.6, 1.05, potW, leaves, 2, 1.0);
  pottedPlant(root, 26.0, -11.5, 1.1, pot, leaves, 4, 1.1);
  pottedPlant(root, -24.6, 21, 1.3, potB, leaves, 6, 1.1);
  practical("home", "#fff0dc", HM(0, 14, 6), 0, 10, 50); // soft room fill at night

  SETS.home = root; root.visible = false; scene.add(root);
}

function buildCafeSet() {
  const root = new THREE.Group(); root.position.copy(CAFE);
  const floor = surfMat("CafeFloor", "#f1e6d4"), brick = surfMat("CafeBrick", "#b86a4e");
  const plaster = surfMat("CafePlaster", "#f0dcc2"), teal = surfMat("CafePlaster", "#2f5d55");
  const wood = surfMat("CafeWood", "#6a432e"), woodL = surfMat("CafeWood", "#b8865c"), ceil = surfMat("CafeWood", "#4d3527");
  const dark = plainMat("#24262c", 0.45, 0.35), brass = plainMat("#c9a063", 0.3, 0.8), stone = plainMat("#2e2c31", 0.3, 0.1);
  const marble = surfMat("Counter", "#f3efe8"), steel = surfMat("Appliance", "#d5dae0"), cream = plainMat("#f6efe2", 0.5);
  const seat = surfMat("Sofa", "#2f6f68"), seatR = surfMat("Sofa", "#c4553f");
  const leaves = [surfMat("HomeLeaf", "#4f8a4a"), surfMat("HomeLeaf", "#68a356"), surfMat("HomeLeaf", "#3d7543")];
  const pot = plainMat("#c4643f", 0.8), potW = plainMat("#ece6dc", 0.6);
  const add = (mesh, x, y, z, ry, rx, rz) => put3(root, mesh, x, y, z, ry, rx, rz);

  // shell
  add(studBox(46, 0.5, 48, floor, false), 0, -0.25, 4);
  add(noShadow(studBox(46, 17, 1, brick)), 0, 8.5, -18.5);
  add(noShadow(studBox(1, 17, 48, plaster)), -22.5, 8.5, 4);
  add(noShadow(studBox(1, 17, 48, plaster)), 22.5, 8.5, 4);
  add(noShadow(studBox(46, 17, 1, plaster)), 0, 8.5, 28.5);
  add(noShadow(studBox(46, 1, 48, ceil)), 0, 17.2, 4);
  for (let x = -18; x <= 18; x += 6) add(noShadow(studBox(0.8, 1.0, 48, wood)), x, 16.4, 4);
  for (const sx of [-1, 1]) add(noShadow(studBox(0.4, 2.6, 46, teal)), sx * 21.8, 1.3, 4);
  add(noShadow(studBox(0.5, 0.25, 46, woodL)), -21.75, 2.7, 4); add(noShadow(studBox(0.5, 0.25, 46, woodL)), 21.75, 2.7, 4);

  // big street windows: back-left and the whole left wall
  const winMat = new THREE.MeshBasicMaterial({ fog: false });
  setWindows.cafe.push(winMat);
  const grid = (cx, cy, w, h, nx, ny, side) => {
    const P = side ? (a, y, b) => [-21.85 + b, y, a] : (a, y, b) => [a, y, -17.9 + b];
    const pane = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), winMat), ...P(cx, cy, 0), side ? Math.PI / 2 : 0);
    const bar = (len, vertical, a, y) => {
      const m = vertical ? studBox(side ? 0.3 : 0.35, len, side ? 0.35 : 0.3, dark) : studBox(side ? 0.3 : len, 0.35, side ? len : 0.3, dark);
      add(noShadow(m), ...P(a, y, 0.15));
    };
    for (let i = 0; i <= nx; i++) bar(h + 0.35, true, cx - w / 2 + (i * w) / nx, cy);
    for (let j = 0; j <= ny; j++) bar(w, false, cx, cy - h / 2 + (j * h) / ny);
    return pane;
  };
  grid(-12.5, 8.2, 14, 10, 3, 2, false);
  grid(-1, 8.2, 20, 10, 4, 2, true);
  add(studBox(15, 0.4, 1.2, woodL), -12.5, 2.95, -17.5);
  // neon sign over the window and the menu board over the counter
  add(picture(8, 2, (g, w, h) => { g.fillStyle = "#1a1418"; g.fillRect(0, 0, w, h); g.shadowColor = "#ff6fa8"; g.shadowBlur = 24; g.fillStyle = "#ffb3d0"; g.font = "700 84px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("MOON BEAN ☾", w / 2, h / 2 + 4); }), -12.5, 14.6, -17.92);
  add(studBox(10.8, 5.8, 0.3, wood), 9, 12.6, -17.9);
  cafeMenuTex0 = menuTex(defaultMenu);
  cafeMenu = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: cafeMenuTex0, fog: false }));
  add(cafeMenu, 9, 12.6, -17.7);

  // counter with espresso machine, register, pastry stand, mugs, and the back bar shelves
  add(studBox(18, 3.4, 3.4, wood), 9, 1.7, -13.2);
  for (let i = 0; i < 6; i++) add(studBox(2.6, 2.5, 0.12, woodL), 1.5 + i * 3, 1.75, -11.45);
  add(studBox(18.6, 0.35, 4.0, stone), 9, 3.57, -13.2);
  add(studBox(3.4, 2.4, 2.1, steel), 13.8, 4.95, -13.8);
  add(studBox(3.6, 0.3, 2.3, dark), 13.8, 6.3, -13.8);
  for (const dx of [-0.8, 0.8]) { add(cyl(0.25, 0.25, 0.5, dark), 13.8 + dx, 4.2, -12.75); add(cyl(0.32, 0.25, 0.5, cream), 13.8 + dx, 4.0, -12.55); }
  add(studBox(1.8, 1.0, 1.4, dark), 4.2, 4.25, -13.6, 0.2, -0.3);
  add(studBox(1.2, 0.2, 0.9, steel), 4.2, 3.85, -13.0, 0.2);
  // pastry stand with cupcakes
  for (const [y, r] of [[3.85, 1.3], [4.75, 0.95], [5.55, 0.6]]) add(cyl(r, r, 0.1, cream), 8.8, y, -13);
  add(cyl(0.08, 0.08, 1.8, brass, 8), 8.8, 4.7, -13);
  for (const [i, c] of ["#f4a6c0", "#ffe08a", "#c79566", "#a4d4c5", "#f4a6c0"].entries()) {
    const a = i * 1.25, y = i < 3 ? 3.9 : 4.8, rr = i < 3 ? 0.85 : 0.55;
    add(cyl(0.32, 0.26, 0.35, plainMat("#c08a55", 0.8)), 8.8 + Math.cos(a) * rr, y + 0.18, -13 + Math.sin(a) * rr);
    add(ball(0.33, plainMat(c, 0.6), 1, 0.7, 1), 8.8 + Math.cos(a) * rr, y + 0.45, -13 + Math.sin(a) * rr);
  }
  add(cyl(0.55, 0.55, 1.2, plainMat("#cfe2e0", 0.15, 0.1)), 6.2, 4.35, -12.4);
  add(cyl(0.58, 0.58, 0.18, brass), 6.2, 5.0, -12.4);
  for (const y of [6.6, 9.2]) {
    add(studBox(16, 0.3, 1.5, woodL), 9, y, -17.2);
    for (let i = 0; i < 9; i++) {
      const x = 2 + i * 1.75, c = ["#f6efe2", "#2a9d8f", "#e9c46a", "#e76f51", "#f6efe2", "#264653"][(i + (y > 7 ? 2 : 0)) % 6];
      if (i % 3 === 2) add(cyl(0.45, 0.45, 1.3, plainMat("#d8e8e4", 0.15, 0.1)), x, y + 0.8, -17.1);
      else add(cyl(0.38, 0.32, 0.75, plainMat(c, 0.5)), x, y + 0.53, -17.1);
    }
  }
  // bar stools along the counter
  for (const x of [4.5, 9, 13.5]) {
    add(cyl(0.95, 0.95, 0.3, seatR), x, 3.1, -9.6);
    add(cyl(0.12, 0.12, 3.0, brass, 8), x, 1.5, -9.6);
    add(cyl(0.8, 0.9, 0.12, dark), x, 0.06, -9.6);
    add(shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 16), brass)), x, 1.2, -9.6, 0, Math.PI / 2);
  }

  // banquette under the left window, tables and bistro chairs
  add(studBox(3.0, 1.9, 20, seat), -20.2, 0.95, -1);
  add(studBox(1.0, 2.6, 20, seat), -21.3, 3.2, -1);
  const table = (x, z, r = 2.1) => {
    add(cyl(r, r, 0.2, marble, 28), x, 2.95, z);
    add(cyl(0.2, 0.2, 2.8, dark, 10), x, 1.45, z);
    add(cyl(1.0, 1.05, 0.15, dark, 20), x, 0.08, z);
  };
  const chair = (x, z, ry) => {
    const g = new THREE.Group(); put3(root, g, x, 0, z, ry);
    put3(g, cyl(1.0, 1.0, 0.25, wood), 0, 1.95, 0);
    for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) put3(g, cyl(0.09, 0.09, 1.9, dark, 6), sx, 0.95, sz);
    put3(g, studBox(1.9, 0.35, 0.25, wood), 0, 4.0, -0.9); put3(g, studBox(1.9, 0.3, 0.25, wood), 0, 3.1, -0.9);
    for (const sx of [-0.85, 0.85]) put3(g, studBox(0.2, 2.2, 0.2, dark), sx, 3.0, -0.9);
  };
  // the window two-top: the couple sits side by side behind it, facing the room, legs hidden by the front panel
  add(studBox(8.6, 0.25, 3.2, marble), -7, 2.93, -1.6);
  add(studBox(8.2, 1.3, 0.2, wood), -7, 2.15, -0.15);
  for (const sx of [-1, 1]) add(studBox(0.35, 2.8, 2.6, dark), -7 + sx * 3.9, 1.4, -1.6);
  chair(-9.2, -3.7, 0.22); chair(-4.8, -3.7, -0.22);
  for (const [dx, c] of [[-2.2, "#f6efe2"], [2.2, "#e9c46a"]]) { add(cyl(0.34, 0.28, 0.55, plainMat(c, 0.5)), -7 + dx, 3.33, -1.9); add(cyl(0.55, 0.55, 0.05, cream), -7 + dx, 3.07, -1.9); }
  add(cyl(0.18, 0.15, 0.5, plainMat("#cfe2e0", 0.15)), -7, 3.3, -2.4); add(ball(0.3, plainMat("#f4a6c0", 0.6)), -7, 3.75, -2.4);
  table(-16.5, -11, 1.6); table(-16.5, 7, 1.6); table(4, 4, 1.8);
  chair(-13.8, -11, -Math.PI / 2); chair(-13.8, 7, -Math.PI / 2); chair(1.4, 4, Math.PI / 2); chair(6.6, 4, -Math.PI / 2);
  add(cyl(0.34, 0.28, 0.55, cream), -16.2, 3.33, 7.2); add(cyl(0.34, 0.28, 0.55, cream), 4.4, 3.33, 4.2);

  // pendant lamps, string lights across the ceiling, plants, art and the door
  for (const [x, z] of [[-7, -2], [-16.5, -11], [-16.5, 7], [4, 4], [9, -9.6]]) {
    add(noShadow(cyl(0.04, 0.04, 4.2, dark, 6)), x, 14.8, z);
    add(noShadow(cyl(0.4, 1.0, 0.9, brass)), x, 12.5, z);
    add(noShadow(ball(0.36, glowMat("cafe", "#ffd59a", 1.0, 2.6))), x, 12.0, z);
  }
  const bulb = glowMat("cafe", "#ffe0a0", 0.8, 3.0), cord = plainMat("#2a2420", 0.8);
  for (const z of [-12, -2, 8, 18]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const x = -21 + (42 * i) / 16; pts.push([x, 15.4 - 1.6 * Math.sin((Math.PI * i) / 16), z + Math.sin(i * 0.7) * 0.3]); }
    for (let i = 0; i < pts.length; i++) {
      const [x, y, zz] = pts[i];
      add(noShadow(ball(0.2, bulb)), x, y - 0.25, zz);
      if (i) { const [x0, y0, z0] = pts[i - 1], len = Math.hypot(x - x0, y - y0); add(noShadow(new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), cord)), (x + x0) / 2, (y + y0) / 2, (zz + z0) / 2, 0, 0, Math.atan2(y - y0, x - x0)); }
    }
  }
  practical("cafe", "#ffc27a", CF(-7, 10.5, -0.5), 5, 30, 32);
  practical("cafe", "#ffc88a", CF(9, 10.5, -11), 4, 26, 30);
  practical("cafe", "#ffd09a", CF(-4, 12, 10), 2, 18, 40);
  pottedPlant(root, -19.6, -15.8, 1.3, pot, leaves, 11, 1.2);
  pottedPlant(root, 20.2, -15.8, 1.2, potW, leaves, 12, 1.1);
  pottedPlant(root, 19.8, 18, 1.3, pot, leaves, 13, 1.1);
  pottedPlant(root, -19.8, 20, 1.2, potW, leaves, 14, 1.0);
  for (const [x, z] of [[-17, -15], [-4, -15]]) {
    add(noShadow(cyl(0.03, 0.03, 3.5, dark, 4)), x, 15.2, z);
    add(cyl(0.7, 0.5, 0.8, potW), x, 13.1, z);
    for (let i = 0; i < 6; i++) add(ball(0.5, leaves[i % 3], 1, 1.3, 1), x + Math.cos(i) * 0.6, 12.6 - (i % 3) * 0.7, z + Math.sin(i) * 0.6);
  }
  for (const [z, draw] of [
    [-6, (g, w, h) => { g.fillStyle = "#e9c46a"; g.fillRect(0, 0, w, h); g.fillStyle = "#6a432e"; g.beginPath(); g.ellipse(w / 2, h * 0.6, 120, 90, 0, 0, 7); g.fill(); g.fillStyle = "#f6efe2"; g.fillRect(w / 2 - 130, h * 0.35, 260, 40); g.strokeStyle = "#6a432e"; g.lineWidth = 16; g.beginPath(); g.arc(w / 2 + 150, h * 0.6, 40, -1.4, 1.4); g.stroke(); }],
    [2, (g, w, h) => { g.fillStyle = "#2f5d55"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(w / 2, h / 2, 130, 0, 7); g.fill(); g.fillStyle = "#2f5d55"; g.beginPath(); g.arc(w / 2 + 60, h / 2 - 30, 120, 0, 7); g.fill(); }],
  ]) {
    add(studBox(0.25, 5.4, 4.4, wood), 22.05, 8.5, z);
    add(picture(4, 5, draw), 21.88, 8.5, z, -Math.PI / 2);
  }
  add(studBox(0.3, 9, 5, wood), 22.05, 4.5, 12);
  const doorPane = add(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), winMat), 21.85, 5.6, 12, -Math.PI / 2);
  doorPane.castShadow = false;
  add(studBox(0.3, 0.25, 1.2, brass), 21.8, 4.2, 10.2);

  SETS.cafe = root; root.visible = false; scene.add(root);
}

/** set the home tv picture or the cafe menu board (textures from tvTex / menuTex); reset every frame */
function setHomeTv(tex) { homeTv.material.map = tex || homeTvTex0; }
function setCafeMenu(tex) { cafeMenu.material.map = tex || cafeMenuTex0; }
/** place someone in a set seat: sitIn(A.bo, HM, HOME_SEATS.sofaL, "Sit", t, "happy", { clipB, wb, ry }) */
function sitIn(actor, at, slot, clip, t, face, o = {}) {
  const [x, y, z, ry] = slot, p = at(x + (o.dx || 0), y + (o.dy || 0), z + (o.dz || 0));
  actor.place(p.x, p.z, ry + (o.ry || 0), p.y, o.size || 1)
    .pose(clip, t, o.clipB || null, o.wb || 0, o.tb ?? t).face(face);
  return actor;
}
// Recommended cameras. Each preset is a slow push: from p0 looking at t0 to p1 looking at t1.
// Use with shotCam(t, u, CAM_HOME.wide) and nudge with { move: [x, y, z], aim: [x, y, z], fov, ease, shake }.
const camP = (at, p0, t0, p1, t1, fov) => ({ p0: at(...p0), t0: at(...t0), p1: at(...p1), t1: at(...(t1 || t0)), fov });
const CAM_HOME = {
  wide: camP(HM, [14, 11.5, 25], [-2, 3.6, -9], [11.5, 10.2, 21], [-2, 3.6, -9], 50),        // whole open plan: sofa, dog bed, kitchen
  living: camP(HM, [-8, 8.2, 15], [-12, 3.8, -12], [-9.5, 7.6, 12], [-12, 3.8, -12], 50),     // sofa, coffee table, window behind
  sofa: camP(HM, [-12, 6.0, 4.5], [-12, 4.3, -14.6], [-12, 5.8, 2.5], [-12, 4.3, -14.6], 42), // the three sofa seats over the coffee table
  kitchen: camP(HM, [10.5, 7, 13], [13.5, 4.6, -11], [11, 6.6, 10], [13.5, 4.6, -11], 46),   // table, counter and fridge behind
  table: camP(HM, [12.5, 7.6, 11], [12.5, 4.0, -7.5], [12.5, 7.2, 8.6], [12.5, 4.0, -7.5], 42),        // dining table, pancakes, kitchen behind
  dogbed: camP(HM, [-7.2, 4.2, 10.5], [-1.5, 1.5, -2], [-6.4, 3.9, 9.0], [-1.5, 1.5, -2], 44), // low three-quarter angle on Biscuit's bed
  window: camP(HM, [-4, 5.2, 4], [-12, 6.5, -19], [-5.5, 5.0, 2], [-12, 6.5, -19], 48),      // toward the window: rim-lit silhouettes
};
const CAM_CAFE = {
  wide: camP(CF, [12, 10.5, 22], [-4, 3.8, -6], [9.5, 9.4, 18.5], [-4, 3.8, -6], 50),       // the couple's table, window, counter
  table: camP(CF, [-7, 7.2, 14], [-7, 4.3, -3.2], [-7, 6.8, 11.5], [-7, 4.3, -3.2], 46),        // two-shot at the window two-top
  left: camP(CF, [-6.6, 5.9, 11.5], [-9.2, 5.0, -3.7], [-7.0, 5.7, 9.2], [-9.2, 5.0, -3.7], 40),   // single on the left seat
  right: camP(CF, [-7.4, 6.0, 11.5], [-4.8, 5.2, -3.7], [-7.0, 5.8, 9.2], [-4.8, 5.2, -3.7], 40),  // single on the right seat
  counter: camP(CF, [6, 7, 12], [9, 4.8, -12], [6.5, 6.6, 9], [9, 4.8, -12], 46),            // counter, menu board and shelves
  menu: camP(CF, [9, 6.4, 6], [9, 12.3, -17.7], [9, 7.0, 3], [9, 12.3, -17.7], 46),        // menu board, under the pendant
  window: camP(CF, [4, 6, 6], [-18, 5.6, -4], [2.5, 5.8, 4.5], [-18, 5.6, -4], 46),           // across the room to the street window
};
const _m = v3(0, 0, 0), _a = v3(0, 0, 0), _p0 = v3(0, 0, 0), _t0 = v3(0, 0, 0), _p1 = v3(0, 0, 0), _t1 = v3(0, 0, 0);
/**
 * Frame someone at local (x, ty, z) in a set (at = HM or CF) from `dist` studs away; yaw is the camera's
 * direction from the subject (0 = from +Z, the open side). Pushes in by `push` over the shot.
 * The 9:16 frame is narrow (about 0.45 × dist wide at fov 46), so stand well back. Good distances at fov 46:
 * adult mid shot 11–13 with ty ≈ 4.4 (Bo 4.7, Pip 3.4); two people 15–17; punchline close-up 8 with ty at eye
 * level (Bo 5.6, Mira 5.2, Pip 4.2, Kai 5.4, Nova 5.0); Biscuit 10–12 with ty ≈ 1.8.
 */
function frameOn(t, u, at, x, z, ty, dist, { yaw = 0, lift = 0.7, fov = 46, push = 0.12, shake = 0, ease = easeOut } = {}) {
  const sx = Math.sin(yaw), sz = Math.cos(yaw), d0 = dist * (1 + push);
  cam(t, at(x + sx * d0, ty + lift, z + sz * d0), at(x, ty, z), at(x + sx * dist, ty + lift * 0.9, z + sz * dist), at(x, ty, z), ease(u), shake, fov);
}
function shotCam(t, u, preset, { move = [0, 0, 0], aim = [0, 0, 0], fov = preset.fov, ease = easeOut, shake = 0 } = {}) {
  _m.set(...move); _a.set(...aim);
  _p0.copy(preset.p0).add(_m); _p1.copy(preset.p1).add(_m);
  _t0.copy(preset.t0).add(_m).add(_a); _t1.copy(preset.t1).add(_m).add(_a);
  cam(t, _p0, _t0, _p1, _t1, ease(u), shake, fov);
}

// ------------------------------------------------ scene kit (JSON layouts in core/scenes/<id>.json)
// A film names a kit scene in its env string ("park dusk") or calls useScene("park"); the layout is
// fetched and built at load. Only scenes a film uses are built, so other films are unaffected.
const BUILTIN_SETS = ["town", "house", "room", "forest", "highway", "home", "cafe"];
const SCENES = {};       // id -> handle from useScene()
const kitWindows = [];   // [material, { day, dusk, night }]
const kitBackdrops = {};
/**
 * A kit scene handle, filled in once the layout loads:
 *   S.at(x, y, z)  scene-local → world (like HM / CF)     S.cam.<name>   presets for shotCam()
 *   S.seats.<name> slots for sitIn(actor, S.at, slot, …)   S.marks.<name> [x, z, ry] standing marks
 *   S.put(actor, mark | [x, z, ryDeg], clip, t, face, { dx, dz, ry, size })
 *   S.frame(t, u, x, z, ty, dist, opts) = frameOn(t, u, S.at, …)   S.shot(t, u, camName, opts) = shotCam(…)
 */
function useScene(id) {
  if (SCENES[id]) return SCENES[id];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`bad scene id "${id}"`);
  const origin = v3(1300 + 400 * Object.keys(SCENES).length, 0, 0);
  const S = {
    id, origin, layout: null, cam: {}, seats: {}, marks: {},
    at: (x, y, z) => v3(origin.x + x, y, origin.z + z),
    put(actor, mark, clip, t, face, o = {}) {
      const [x, z, ry] = typeof mark === "string" ? (S.marks[mark] || (() => { throw new Error(`scene ${id}: no mark "${mark}"`); })()) : [mark[0], mark[1], ((mark[2] || 0) * PI) / 180];
      return actor.place(origin.x + x + (o.dx || 0), origin.z + z + (o.dz || 0), ry + (o.ry || 0), o.y || 0, o.size || 1).pose(clip, t, o.clipB || null, o.wb || 0, o.tb ?? t).face(face);
    },
    sit(actor, seat, clip, t, face, o = {}) {
      const slot = S.seats[seat];
      if (!slot) throw new Error(`scene ${id}: no seat "${seat}"`);
      return sitIn(actor, S.at, slot, clip, t, face, o);
    },
    frame: (t, u, x, z, ty, dist, o) => frameOn(t, u, S.at, x, z, ty, dist, o),
    shot(t, u, name, o) {
      const p = S.cam[name];
      if (!p) throw new Error(`scene ${id}: no camera "${name}"`);
      return shotCam(t, u, p, o);
    },
  };
  return (SCENES[id] = S);
}
async function loadKitScene(S) {
  const res = await fetch(`core/scenes/${S.id}.json`);
  if (!res.ok) throw new Error(`unknown set "${S.id}": no core/scenes/${S.id}.json`);
  const L = await res.json();
  S.layout = L;
  setLights[S.id] = []; setGlows[S.id] = [];
  const built = buildKitScene(L, {
    studBox, surfMat, canvasTex,
    glow: (color, day, night) => glowMat(S.id, color, day, night),
    light: (color, p, day, night, dist) => {
      if (setLights[S.id].length >= 6) return console.warn(`scene ${S.id}: more than 6 lamp lights, extra ones only glow`);
      practical(S.id, color, S.at(p[0], p[1], p[2]), day, night, dist);
    },
    windowMat: (view) => {
      const kind = view === "street" ? "street" : "garden";
      kitBackdrops[kind] = kitBackdrops[kind] || { day: backdropTex(kind, "day"), dusk: backdropTex(kind, "dusk"), night: backdropTex(kind, "night") };
      const m = new THREE.MeshBasicMaterial({ fog: false, map: kitBackdrops[kind].day });
      kitWindows.push([m, kitBackdrops[kind]]); return m;
    },
  });
  built.root.position.copy(S.origin);
  built.root.visible = false; scene.add(built.root);
  SETS[S.id] = built.root;
  Object.assign(S.seats, built.seats); Object.assign(S.marks, built.marks);
  for (const [k, c] of Object.entries(built.cams)) {
    const to = c.to, from = c.from;
    const end = c.end || from.map((v, i) => v + (to[i] - v) * 0.12);
    S.cam[k] = camP(S.at, from, to, end, c.endTo || to, c.fov || 46);
  }
}

function renderAt(t) {
  if (!ready) return;
  t = Math.min(Math.max(t, 0), PLAN.duration - 1e-4);
  // reset the stage
  for (const k in A) { A[k].root.visible = false; A[k].number(null); }
  for (const a of crowd) { a.root.visible = false; a.number(null); }
  for (const o of [stone, pancakes, car, roadCar, ship, greenStar, ...books, ...puffs, ...sparks, ...beams]) if (o) o.visible = false;
  setHomeTv(null); setCafeMenu(null);
  stoneLight.intensity = 0; glow.intensity = 0; stereoGlow = null;
  board.material.map = boardTex0;
  if (stereo) stereo.material.map = stereoTex0;
  setHighway(0);
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
  SETS.highway.visible = set === "highway";
  SETS.home.visible = set === "home";
  SETS.cafe.visible = set === "cafe";
  for (const k in SCENES) if (SETS[k]) SETS[k].visible = set === k;
  setEnv(...MOODS[mood]);
  const outside = MOODS[mood][0] > 0.6 ? "night" : MOODS[mood][0] > 0.2 ? "dusk" : "day";
  for (const k in setWindows) for (const m of setWindows[k]) m.map = setWinTex[k][outside];
  for (const [m, tex] of kitWindows) m.map = tex[outside];
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
  const [charGltf, townGltf, setsGltf, dogGltf] = await Promise.all([
    ...["character", "town", "sets"].map((f) => loader.loadAsync(`${STYLE.assets}/${f}.glb`)),
    loader.loadAsync(STYLE.dog),
  ]);
  for (const c of charGltf.animations) clipDur[c.name] = c.duration;
  for (const k in CAST) A[k] = makeActor(charGltf.scene, charGltf.animations, CAST[k]);
  for (const c of dogGltf.animations) dogDur[c.name] = c.duration;
  for (const k in DOGS) A[k] = makeDog(dogGltf.scene, dogGltf.animations, DOGS[k]);
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
  buildHighwaySet();
  buildRoadCar();
  setWinTex = Object.fromEntries([["home", "garden"], ["cafe", "street"]].map(([k, kind]) =>
    [k, { day: backdropTex(kind, "day"), dusk: backdropTex(kind, "dusk"), night: backdropTex(kind, "night") }]));
  buildHomeSet();
  buildCafeSet();
  for (const s of config.shots) { const set = String(s[1]).split(" ")[0]; if (!BUILTIN_SETS.includes(set)) useScene(set); }
  await Promise.all(Object.values(SCENES).map(loadKitScene));
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
 *   dogs   extra dogs: { name: { scale, ears, col, face } } (see DOGS)
 *   chests extra chest decals: { name: (g) => draw on a 256x256 canvas }
 *   board  (g, w, h) => draw the tower screen's default 512x1024 picture
 *   setup  async () => build film-only textures or props once assets are loaded
 *   shots  [[cutId, "set mood", stage(t, u, s)], ...] keyed by the plan's cut ids
 */
function createFilm(config) {
  STYLE = resolveStyle(config.style || PLAN.style);
  Object.assign(CAST, config.cast || {});
  Object.assign(DOGS, config.dogs || {});
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
  DOGS, DOG_CLIPS, DOG_FACES, drawDogFace,
  A, crowd, put, WALK, CROWD_N, clipDur, SETS, townMats as mats,
  ROOM, FOREST, HIGHWAY, HOUSE_Z, SHIP_X, SHIP_Z, R, F, HW, ROAD_SEATS,
  board, car, roadCar, stereo, highwaySign, ship, roomWindow, houseWindow, winTex,
  setStone, setPancakes, books, smoke, sparkle, beam, greenStar, glow, stars,
  setHighway, setRoadCar, seatInCar, setStereo, stereoTex, highwaySignTex,
  useScene, SCENES, KIT_PROPS, KIT_PALETTES,
  HOME, CAFE, HM, CF, HOME_SEATS, CAFE_SEATS, CAM_HOME, CAM_CAFE, shotCam, frameOn, sitIn, setHomeTv, setCafeMenu, tvTex, menuTex, homeTv, cafeMenu,
  setEnv, MOODS, cam, FITS, CLOTH_PATTERNS, shade, cloth, weave, sun, hemi, rim, fill, grade, bloom, crowdWalk, crowdRun, crowdArc, arcPos, setCar, setShip, shipBeam,
  createFilm,
};
