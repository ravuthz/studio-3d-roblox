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

const PLAN = window.STORY_PLAN;
const C = PLAN.cuts;
const W = 1080;
const H = 1920;
const TOWN_SCALE = 1.6;

// ------------------------------------------------------------------ utils
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) ** 3;
const backOut = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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
const DAY = { top: new THREE.Color("#6f8fd8"), mid: new THREE.Color("#ffb37a"), low: new THREE.Color("#ffd9a8") };
const NIGHT = { top: new THREE.Color("#0b1238"), mid: new THREE.Color("#2a3a80"), low: new THREE.Color("#5a4a9a") };
const skyU = { top: { value: DAY.top.clone() }, mid: { value: DAY.mid.clone() }, low: { value: DAY.low.clone() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
      void main(){ float h = clamp(normalize(vP).y, -0.2, 1.0);
        vec3 c = mix(low, mid, smoothstep(-0.05, 0.16, h)); c = mix(c, top, smoothstep(0.12, 0.7, h));
        gl_FragColor = vec4(c, 1.0); }`,
  }),
);
scene.add(sky);
scene.fog = new THREE.Fog("#ffcfa0", 60, 330);

const hemi = new THREE.HemisphereLight("#ffe6cf", "#a07c68", 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffc890", 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.12;
sun.shadow.radius = 9;
scene.add(sun, sun.target);
const fill = new THREE.PointLight("#ffd9a0", 0, 60, 1.6); // follows the subject at night
scene.add(fill);

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
const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.00006, maxblur: 0.006 });
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.7, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.32 }, sat: { value: 1.16 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float sat; uniform vec3 tint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(l), c.rgb, sat) * tint;
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - vig * smoothstep(0.25, 0.85, length(d * vec2(0.9, 1.25)));
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
  t.anisotropy = 4;
  return t;
}

function drawFace(g, expr, o) {
  const brow = o.brow || "#2a2230";
  const line = (pts, w = 8, col = "#1b1820") => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  const arc = (x, y, r, a0, a1, w = 8) => {
    g.strokeStyle = "#1b1820"; g.lineWidth = w; g.lineCap = "round";
    g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  };
  const teeth = (y) => {
    g.fillStyle = "#fff"; g.strokeStyle = "#1b1820"; g.lineWidth = 6;
    g.beginPath(); g.roundRect(96, y, 64, 26, 8); g.fill(); g.stroke();
    for (const x of [112, 128, 144]) line([[x, y + 2], [x, y + 24]], 4);
  };
  const ey = 128, lx = 86, rx = 170;
  g.translate(0, 22);
  if (o.blush) {
    g.fillStyle = "rgba(255,120,130,0.33)";
    for (const x of [58, 198]) { g.beginPath(); g.ellipse(x, 166, 20, 12, 0, 0, Math.PI * 2); g.fill(); }
  }
  if (o.alien) { // big slanted black eyes, no brows
    const k = expr === "shock" ? 1.18 : expr === "sad" ? 0.92 : expr === "angry" ? 0.8 : 1;
    const tilt = expr === "sad" ? -0.15 : expr === "angry" ? 0.75 : 0.42;
    for (const [x, s] of [[80, 1], [176, -1]]) {
      g.fillStyle = expr === "angry" ? "#5a0a0a" : "#12121a";
      g.beginPath(); g.ellipse(x, ey - 4, 25 * k, 36 * k, s * tilt, 0, Math.PI * 2); g.fill();
      g.fillStyle = expr === "angry" ? "#ff5a4a" : "#fff";
      g.beginPath(); g.arc(x - 8, ey - 20, 8 * k, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 8, ey + 6, 4 * k, 0, Math.PI * 2); g.fill();
      if (o.lashes) { line([[x - s * 22, ey - 34], [x - s * 36, ey - 46]], 5); line([[x - s * 28, ey - 22], [x - s * 42, ey - 28]], 5); }
    }
    if (expr === "happy") { g.fillStyle = "#1e4a22"; g.beginPath(); g.arc(128, 188, 22, 0, Math.PI); g.closePath(); g.fill(); }
    else if (expr === "shock") { g.fillStyle = "#1e4a22"; g.beginPath(); g.ellipse(128, 200, 12, 16, 0, 0, Math.PI * 2); g.fill(); }
    else if (expr === "sad") arc(128, 214, 20, Math.PI * 1.2, Math.PI * 1.8, 7);
    else if (expr === "angry") teeth(184);
    else arc(128, 178, 18, Math.PI * 0.2, Math.PI * 0.8, 7);
    return;
  }
  const eye = (x, y, a, b) => {
    g.fillStyle = "#1b1820";
    g.beginPath(); g.ellipse(x, y, a, b, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(x - a * 0.3, y - b * 0.4, a * 0.36, 0, Math.PI * 2); g.fill();
  };
  if (expr === "shock") {
    eye(lx, ey, 17, 25); eye(rx, ey, 17, 25);
    line([[lx - 20, ey - 46], [lx + 14, ey - 52]], 7, brow); line([[rx - 14, ey - 52], [rx + 20, ey - 46]], 7, brow);
    g.fillStyle = "#3a1220"; g.beginPath(); g.ellipse(128, 196, 17, 22, 0, 0, Math.PI * 2); g.fill();
  } else if (expr === "sad") {
    eye(lx, ey + 4, 13, 18); eye(rx, ey + 4, 13, 18);
    line([[lx - 20, ey - 28], [lx + 16, ey - 42]], 7, brow); line([[rx - 16, ey - 42], [rx + 20, ey - 28]], 7, brow);
    arc(128, 214, 24, Math.PI * 1.2, Math.PI * 1.8);
  } else if (expr === "happy") {
    eye(lx, ey, 14, 21); eye(rx, ey, 14, 21);
    line([[lx - 18, ey - 42], [lx + 16, ey - 46]], 7, brow); line([[rx - 16, ey - 46], [rx + 18, ey - 42]], 7, brow);
    g.fillStyle = "#3a1220"; g.beginPath(); g.arc(128, 180, 27, 0, Math.PI); g.closePath(); g.fill();
    g.fillStyle = "#ff8f9c"; g.beginPath(); g.ellipse(128, 198, 13, 7, 0, 0, Math.PI * 2); g.fill();
  } else if (expr === "smug") {
    eye(lx, ey, 14, 20); eye(rx, ey, 14, 20);
    line([[lx - 20, ey - 46], [lx + 16, ey - 34]], 8, brow); line([[rx - 16, ey - 34], [rx + 20, ey - 46]], 8, brow);
    line([[104, 190], [128, 196], [156, 182]], 8);
  } else if (expr === "angry") {
    eye(lx, ey + 2, 14, 17); eye(rx, ey + 2, 14, 17);
    line([[lx - 22, ey - 44], [lx + 18, ey - 24]], 10, brow); line([[rx - 18, ey - 24], [rx + 22, ey - 44]], 10, brow);
    teeth(o.mustache ? 190 : 178);
  } else {
    eye(lx, ey, 14, 21); eye(rx, ey, 14, 21);
    line([[lx - 18, ey - 42], [lx + 16, ey - 44]], 7, brow); line([[rx - 16, ey - 44], [rx + 18, ey - 42]], 7, brow);
    arc(128, 172, 24, Math.PI * 0.2, Math.PI * 0.8);
  }
  if (o.lashes) for (const [x, d] of [[lx, -1], [rx, 1]]) {
    line([[x + d * 13, ey - 14], [x + d * 25, ey - 24]], 5); line([[x + d * 16, ey - 4], [x + d * 28, ey - 8]], 5);
  }
  if (o.mustache) {
    g.fillStyle = o.mustache;
    g.beginPath(); g.ellipse(106, 166, 26, 11, -0.2, 0, Math.PI * 2); g.ellipse(150, 166, 26, 11, 0.2, 0, Math.PI * 2); g.fill();
  }
}
const EXPRS = ["neutral", "happy", "shock", "sad", "smug", "angry"];
const faceSet = (o) => Object.fromEntries(EXPRS.map((e) => [e, canvasTex(256, 256, (g) => drawFace(g, e, o))]));

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
const CAST = {
  zero: { hair: "Zero", scale: 0.86, chest: "zero", face: { blush: true, brow: "#27304f" },
    col: { Skin: "#f4cda6", Shirt: "#f3f3f6", Pants: "#2f3a56", Shoes: "#2ec4b6", Hair: "#27304f" } },
  zeebra: { hair: "Zeebra", scale: 1.0, chest: "stripes", face: { brow: "#17171c" },
    col: { Skin: "#eec39a", Shirt: "#f3f3f6", Pants: "#1d1d22", Shoes: "#f4f4f4", Hair: "#17171c", HairStreak: "#ffffff", Acc: "#e23d3d" } },
  luna: { hair: "Luna", scale: 1.05, chest: "moon", face: { lashes: true, blush: true, brow: "#4a2c78" },
    col: { Skin: "#f6d3b0", Shirt: "#2c3e7a", Pants: "#6b4fa0", Shoes: "#f4f4f4", Hair: "#5b3a8c", Acc: "#ffd23c" } },
  zip: { hair: "Zip", scale: 1.1, chest: "zipper", face: { mustache: "#6b4226", brow: "#6b4226" },
    col: { Skin: "#e9bd92", Shirt: "#f2b632", Pants: "#3a4a6b", Shoes: "#5a3b28", Hair: "#6b4226", Acc: "#2b6cb0", HairStreak: "#ffffff" } },
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
  model.scale.setScalar(def.scale);
  root.add(model);
  const faces = faceSet(def.face || {});
  const chestTex = canvasTex(256, 256, CHESTS[def.chest || "none"]);
  let faceMat;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.name.startsWith("M_Hair_")) o.visible = o.name.startsWith("M_Hair_" + def.hair);
    const fix = (m) => {
      if (m.name === "Face" || m.name === "Chest") {
        const nm = new THREE.MeshStandardMaterial({
          map: m.name === "Face" ? faces.neutral : chestTex, transparent: true, alphaTest: 0.04,
          roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        });
        nm.name = m.name;
        if (m.name === "Face") faceMat = nm;
        return nm;
      }
      const nm = m.clone();
      if (def.col[m.name]) nm.color.set(def.col[m.name]);
      nm.roughness = 0.82;
      if (def.glow && m.name === "Acc") { nm.emissive.set(def.col.Acc); nm.emissiveIntensity = 1.6; }
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
  const headY = 5.3 * def.scale;
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
function setEnv(n, green = 0, red = 0) {
  for (const k of ["top", "mid", "low"]) skyU[k].value.lerpColors(DAY[k], NIGHT[k], n).lerp(GREEN[k], green);
  scene.fog.color.set("#ffcfa0").lerp(_c.set("#1a2150"), n).lerp(_c.set("#1c6a40"), green * 0.8);
  hemi.color.set("#ffe6cf").lerp(_c.set("#5f78d8"), n).lerp(_c.set("#7dffb0"), green * 0.7);
  hemi.groundColor.set("#a07c68").lerp(_c.set("#1c1a3a"), n);
  hemi.intensity = lerp(1.6, 1.05, n);
  sun.color.set("#ffc890").lerp(_c.set("#8fa8ff"), n).lerp(_c.set("#9dffb8"), green * 0.6);
  sun.intensity = lerp(2.1, 1.1, n);
  bloom.strength = lerp(0.22, 0.5, n);
  bloom.threshold = lerp(1.08, 1.0, n);
  fill.intensity = 85 * n;
  renderer.toneMappingExposure = lerp(1.0, 1.12, n);
  grade.uniforms.tint.value.set(1 + 0.3 * red, 1 - 0.3 * red, 1 - 0.3 * red);
  grade.uniforms.vig.value = 0.32 + 0.35 * red;
  if (townMats.Glass) townMats.Glass.emissiveIntensity = lerp(0.0, 1.5, n);
  if (townMats.LampGlow) townMats.LampGlow.emissiveIntensity = lerp(0.25, 3.2, n);
  if (townMats.HouseGlass) townMats.HouseGlass.emissiveIntensity = lerp(0.0, 1.5, n);
  if (townMats.RoomLamp) townMats.RoomLamp.emissiveIntensity = lerp(0.3, 3.0, n);
  stars.material.opacity = clamp01(n * 1.4 - 0.4) * (1 - green * 0.7);
}
const MOODS = { day: [0, 0, 0], dusk: [0.42, 0, 0], night: [1, 0, 0], red: [0.25, 0, 1], nightred: [1, 0, 0.7], green: [1, 1, 0] };

const _p = v3(0, 0, 0), _t = v3(0, 0, 0);
function cam(t, p0, t0, p1, t1, u, shake = 0, fov = 55) {
  _p.lerpVectors(p0, p1, u); _t.lerpVectors(t0, t1, u);
  if (shake) {
    _p.x += shake * Math.sin(t * 31.0); _p.y += shake * 0.7 * Math.sin(t * 43.0 + 1.3);
    _t.x += shake * 0.6 * Math.sin(t * 37.0 + 2.1); _t.y += shake * 0.6 * Math.sin(t * 29.0 + 0.4);
  }
  camera.fov = fov; camera.position.copy(_p); camera.lookAt(_t); camera.updateProjectionMatrix();
  const fx = Math.round(_t.x / 4) * 4, fz = Math.round(_t.z / 4) * 4;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx - 55, 62, fz + 38);
  _d.subVectors(_p, _t).setY(0).normalize();
  fill.position.set(_t.x + _d.x * 8 + 2, _t.y + 5, _t.z + _d.z * 8);
  const dist = _p.distanceTo(_t);
  bokeh.uniforms.focus.value = dist;
  bokeh.uniforms.aperture.value = dist < 16 ? 0.00013 : dist < 30 ? 0.00005 : 0.000012;
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
    loader.loadAsync("core/assets/character.glb"), loader.loadAsync("core/assets/town.glb"), loader.loadAsync("core/assets/sets.glb"),
  ]);
  for (const c of charGltf.animations) clipDur[c.name] = c.duration;
  for (const k in CAST) A[k] = makeActor(charGltf.scene, charGltf.animations, CAST[k]);
  const r = mulberry32(77);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  for (let i = 0; i < CROWD_N; i++) {
    crowd.push(makeActor(charGltf.scene, charGltf.animations, {
      hair: pick(["Zero", "Luna", "Zip", "Zero"]), scale: 0.92 + r() * 0.2, chest: "none", face: { blush: r() < 0.4 },
      col: { Skin: pick(SKINS), Shirt: pick(PALETTE), Pants: pick(["#2f3a56", "#3b3b46", "#5a4636", "#3f5a4a"]),
        Shoes: pick(["#f4f4f4", "#2b2b33", "#b23a48"]), Hair: pick(HAIRS), Acc: pick(PALETTE), HairStreak: "#ffffff" },
    }));
  }
  const shadows = (root, mats) => root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of [].concat(o.material)) mats[m.name] = m;
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
 *   cast   extra characters: { name: { hair, scale, chest, face, glow, col } }
 *   chests extra chest decals: { name: (g) => draw on a 256x256 canvas }
 *   board  (g, w, h) => draw the tower screen's default 512x1024 picture
 *   setup  async () => build film-only textures or props once assets are loaded
 *   shots  [[cutId, "set mood", stage(t, u, s)], ...] keyed by the plan's cut ids
 */
function createFilm(config) {
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
  setEnv, MOODS, cam, crowdWalk, crowdRun, crowdArc, arcPos, setCar, setShip, shipBeam,
  createFilm,
};
