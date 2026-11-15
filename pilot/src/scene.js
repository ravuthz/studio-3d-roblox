// The 3D film: a pure function of time. HyperFrames seeks frames in any order,
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
const M = PLAN.marks;
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
// number badges live in their own scene, drawn after post-processing so they stay crisp
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
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.32 }, sat: { value: 1.16 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float sat; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(l), c.rgb, sat);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - vig * smoothstep(0.25, 0.85, length(d * vec2(0.9, 1.25)));
      gl_FragColor = c; }`,
});
composer.addPass(grade);

// ---------------------------------------------------------- canvas textures
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // matches glTF UVs
  t.anisotropy = 4;
  return t;
}

function drawFace(g, expr, o) {
  const brow = o.brow || "#2a2230";
  const eye = (x, y, rx, ry) => {
    g.fillStyle = "#1b1820";
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(x - rx * 0.3, y - ry * 0.4, rx * 0.36, 0, Math.PI * 2); g.fill();
  };
  const line = (pts, w = 8, col = "#1b1820") => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  const arc = (x, y, r, a0, a1, w = 8) => {
    g.strokeStyle = "#1b1820"; g.lineWidth = w; g.lineCap = "round";
    g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  };
  const ey = 128, lx = 86, rx = 170;
  g.translate(0, 22); // features sit below the fringe
  if (o.blush) {
    g.fillStyle = "rgba(255,120,130,0.33)";
    for (const x of [58, 198]) { g.beginPath(); g.ellipse(x, 166, 20, 12, 0, 0, Math.PI * 2); g.fill(); }
  }
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
const EXPRS = ["neutral", "happy", "shock", "sad", "smug"];
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
  none: () => {},
};

const numCache = new Map();
function numberTex(text, color) {
  const key = text + "|" + color;
  if (!numCache.has(key)) {
    const t = canvasTex(320, 200, (g) => {
      g.fillStyle = "rgba(14,16,30,0.82)";
      g.beginPath(); g.roundRect(18, 22, 284, 156, 46); g.fill();
      g.lineWidth = 10; g.strokeStyle = color; g.stroke();
      g.font = "700 138px Fredoka, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = color; g.fillText(text, 160, 108);
    });
    t.flipY = true;
    numCache.set(key, t);
  }
  return numCache.get(key);
}

function boardTex(mode) {
  return canvasTex(512, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, mode === "zero" ? "#3a0612" : "#0b1030"); grad.addColorStop(1, "#05060f");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.textAlign = "center"; g.textBaseline = "middle";
    if (mode === "zero") {
      g.fillStyle = "#ffd23c"; g.font = "700 180px Fredoka, Arial Black, sans-serif";
      g.fillText("ZERO", w / 2, 420);
      g.fillStyle = "#ff5a4a"; g.font = "700 64px Fredoka, Arial Black, sans-serif";
      g.fillText("WE SEE YOU", w / 2, 600);
      g.strokeStyle = "#ffd23c"; g.lineWidth = 12; g.strokeRect(34, 250, w - 68, 440);
      return;
    }
    g.fillStyle = "#8fd3ff"; g.font = "700 70px Fredoka, Arial Black, sans-serif";
    g.fillText("TOWN COUNT", w / 2, 86);
    const rows = [["ZIP", 10], ["LUNA", 9], ["MAYOR", 9], ["BAKER", 8], ["ZEEBRA", 7], ["NOVA", 6], ["PIP", 4], ["ZERO", 0]];
    rows.forEach(([n, v], i) => {
      const y = 200 + i * 98, last = n === "ZERO";
      g.fillStyle = last ? "rgba(255,70,70,0.28)" : "rgba(255,255,255,0.07)";
      g.beginPath(); g.roundRect(30, y - 40, w - 60, 80, 18); g.fill();
      g.font = "700 54px Fredoka, Arial Black, sans-serif";
      g.textAlign = "left"; g.fillStyle = last ? "#ff6b6b" : "#ffffff"; g.fillText(n, 56, y + 2);
      g.textAlign = "right"; g.fillStyle = last ? "#ff6b6b" : "#ffe44a"; g.fillText(String(v), w - 56, y + 2);
    });
  });
}

// ------------------------------------------------------------------- cast
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

let actors = {};
let crowd = [];
let board, boardTexes, townMats = {};
const clipDur = {};

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
  overlay.add(badge);
  scene.add(root);
  return {
    root, def,
    /** blend up to two clips; times are in seconds, looped unless hold is set */
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
    },
    face(expr) { faceMat.map = faces[expr]; },
    place(x, z, ry = 0, y = 0) { root.visible = true; root.position.set(x, y, z); root.rotation.y = ry; },
    number(text, color = "#ffffff", s = 1, dx = 0, dy = 0) {
      badge.visible = text !== null;
      if (text === null) return;
      badge.material.map = numberTex(String(text), color);
      badge.scale.set(2.0 * s, 1.25 * s, 1);
      badge.position.set(root.position.x + dx, root.position.y + headY + 1.15 + 0.45 * (s - 1) + dy, root.position.z);
    },
  };
}

// -------------------------------------------------------------- environment
function setNight(n) {
  skyU.top.value.lerpColors(DAY.top, NIGHT.top, n);
  skyU.mid.value.lerpColors(DAY.mid, NIGHT.mid, n);
  skyU.low.value.lerpColors(DAY.low, NIGHT.low, n);
  scene.fog.color.set("#ffcfa0").lerp(new THREE.Color("#1a2150"), n);
  hemi.color.set("#ffe6cf").lerp(new THREE.Color("#5f78d8"), n);
  hemi.groundColor.set("#a07c68").lerp(new THREE.Color("#1c1a3a"), n);
  hemi.intensity = lerp(1.6, 1.05, n);
  sun.color.set("#ffc890").lerp(new THREE.Color("#8fa8ff"), n);
  sun.intensity = lerp(2.1, 1.1, n);
  bloom.strength = lerp(0.22, 0.5, n);
  bloom.threshold = lerp(1.08, 1.0, n);
  fill.intensity = 120 * n;
  renderer.toneMappingExposure = lerp(1.0, 1.12, n);
  if (townMats.Glass) townMats.Glass.emissiveIntensity = lerp(0.0, 1.5, n);
  if (townMats.LampGlow) townMats.LampGlow.emissiveIntensity = lerp(0.25, 3.2, n);
}

const _p = v3(0, 0, 0), _t = v3(0, 0, 0);
function cam(t, p0, t0, p1, t1, u, shake = 0, fov = 55) {
  _p.lerpVectors(p0, p1, u); _t.lerpVectors(t0, t1, u);
  if (shake) {
    _p.x += shake * Math.sin(t * 31.0); _p.y += shake * 0.7 * Math.sin(t * 43.0 + 1.3);
    _t.x += shake * 0.6 * Math.sin(t * 37.0 + 2.1); _t.y += shake * 0.6 * Math.sin(t * 29.0 + 0.4);
  }
  camera.fov = fov; camera.position.copy(_p); camera.lookAt(_t); camera.updateProjectionMatrix();
  // shadows and night fill follow what the camera looks at
  const fx = Math.round(_t.x / 4) * 4, fz = Math.round(_t.z / 4) * 4;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx - 55, 62, fz + 38);
  fill.position.set(_t.x + 3, _t.y + 6, _t.z + 9);
  // focus on the subject; close shots get a shallower depth of field
  const dist = _p.distanceTo(_t);
  bokeh.uniforms.focus.value = dist;
  bokeh.uniforms.aperture.value = dist < 16 ? 0.00013 : dist < 30 ? 0.00005 : 0.000012;
}

// pop-in scale for a number badge that appears at time t0
const pop = (t, t0, d = 0.28) => (t < t0 ? 0 : backOut(clamp01((t - t0) / d)));

// crowd walker definitions (deterministic)
const rnd = mulberry32(20261115);
const WALK = Array.from({ length: CROWD_N }, (_, i) => ({
  x: (i % 2 ? 1 : -1) * (2.5 + rnd() * 8.5), z: -34 + rnd() * 78, dir: rnd() < 0.5 ? 1 : -1,
  speed: 3.6 + rnd() * 1.6, phase: rnd() * 2, num: 2 + Math.floor(rnd() * 8),
}));

function crowdWalk(t, { numbers = true, drop = null, stopAt = null, count = CROWD_N, behind = null } = {}) {
  for (let i = 0; i < count; i++) {
    const w = WALK[i], a = crowd[i];
    const tt = stopAt === null ? t : Math.min(t, stopAt);
    let z = w.z + w.dir * w.speed * tt;
    z = ((z + 40) % 84 + 84) % 84 - 40;
    if (behind !== null && z > behind - 4) continue; // keep the lens side of the hero clear
    a.place(w.x, z, w.dir > 0 ? 0 : Math.PI);
    const stopped = stopAt !== null && t > stopAt;
    if (stopped) {
      const k = clamp01((t - stopAt) / 0.25);
      a.pose("Walk", tt * 1.15 + w.phase, "Shock", k, t - stopAt);
      a.face("shock");
    } else { a.pose("Walk", tt * 1.15 + w.phase); a.face("neutral"); }
    let n = w.num, col = "#ffffff";
    if (drop !== null && t > drop) {
      n = Math.max(1, w.num - Math.floor((t - drop + i * 0.07) * 3.2)); col = "#ff5a4a";
    }
    a.number(numbers ? n : null, col, 1, drop !== null && t > drop ? 0.08 * Math.sin(t * 60 + i) : 0);
  }
}

// --------------------------------------------------------------------- shots
const Z = { x: 0, z: 8 }; // Zero's home mark
const SHOTS = [
  ["hookA", (t, u) => { // crane down over the street
    crowdWalk(t);
    cam(t, v3(0, 58, 78), v3(0, 6, -10), v3(0, 30, 58), v3(0, 8, -14), smooth(u));
  }],
  ["hookB", (t, u) => { // low side angle: numbers pass by
    crowdWalk(t, { count: 9 });
    [[4.5, 30, 1], [7.5, 6, 1], [2.2, -6, 1], [9.5, 24, -1], [6, 44, -1]].forEach(([x, z0, d], i) => {
      const a = crowd[9 + i];
      a.place(x, 14 + (z0 - 14) * 0.35 + d * 4.4 * (t - C.hookB) - d * 5, d > 0 ? 0 : Math.PI);
      a.pose("Walk", t * 1.2 + i * 0.37); a.face(i % 2 ? "happy" : "neutral"); a.number([8, 5, 9, 6, 7][i], "#ffffff", 1.15);
    });
    cam(t, v3(-11, 3.4, 20), v3(4, 6.4, 13), v3(-9.5, 3.8, 17), v3(4.5, 6.6, 12), u);
  }],
  ["zero", (t, u) => {
    crowdWalk(t, { count: 10, behind: Z.z });
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Wave", t); actors.zero.face("happy");
    actors.zero.number(0, "#ffffff", 1.25 * pop(t, M.popZero - 0.05));
    cam(t, v3(1.6, 4.4, 19.5), v3(0, 4.25, 8), v3(0.9, 4.3, 16.6), v3(0, 4.3, 8), easeOut(u));
  }],
  ["zeebra", (t, u) => {
    crowdWalk(t, { count: 10, behind: 2 });
    actors.zeebra.place(-6, 2, 0.25); actors.zeebra.pose("Talk", t, "Cheer", 0.35 * pop(t, M.popSeven, 0.4)); actors.zeebra.face("smug");
    actors.zeebra.number(7, "#ffffff", 1.25 * pop(t, M.popSeven - 0.05));
    cam(t, v3(-9.4, 4.2, 13.5), v3(-6, 5.2, 2), v3(-7.2, 4.6, 12.4), v3(-6, 5.3, 2), easeOut(u));
  }],
  ["luna", (t, u) => {
    crowdWalk(t, { count: 10, behind: 4 });
    actors.luna.place(6, 4, -0.25); actors.luna.pose("Wave", t + 0.4); actors.luna.face("happy");
    actors.luna.number(9, "#ffffff", 1.25 * pop(t, M.popNine - 0.05));
    cam(t, v3(9.2, 4.6, 16), v3(6, 5.5, 4), v3(7.3, 4.9, 14.8), v3(6, 5.6, 4), easeOut(u));
  }],
  ["zipA", (t, u) => {
    crowdWalk(t, { count: 10, behind: -2 });
    actors.zip.place(0, -2); actors.zip.pose("Talk", t); actors.zip.face("happy");
    actors.zip.number(null);
    cam(t, v3(-2.6, 4.8, 10.5), v3(0, 5.4, -2), v3(-1.6, 5.0, 9.2), v3(0, 5.5, -2), easeOut(u));
  }],
  ["zipB", (t, u) => { // low hero angle, the ten lands
    actors.zip.place(0, -2); actors.zip.pose("Point", t, "Cheer", 0.8 * pop(t, M.popTen, 0.3), t - M.popTen); actors.zip.face("smug");
    actors.zip.number(10, "#ffd23c", 1.55 * pop(t, M.popTen - 0.05));
    cam(t, v3(1.4, 1.9, 7.2), v3(0, 6.0, -2), v3(1.0, 2.1, 6.2), v3(0, 6.4, -2), easeOut(u), 0, 62);
  }],
  ["rule", (t, u) => { // crane up the count board
    board.material.map = boardTexes.list;
    crowd.slice(0, 7).forEach((a, i) => {
      a.place(-9 + i * 3 + (i % 2), -50 - (i % 3) * 2.2, Math.PI); a.pose("LookUp", t + i * 0.3); a.face("neutral"); a.number(WALK[i].num);
    });
    cam(t, v3(0, 5.5, -30), v3(0, 15, -71), v3(0, 15, -37), v3(0, 29, -71), smooth(u));
  }],
  ["meA", (t, u) => {
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Sad", t); actors.zero.face("sad");
    actors.zero.number(0, "#9aa0b4", 0.95);
    cam(t, v3(-1.9, 4.5, 15.8), v3(0, 4.2, 8), v3(-1.2, 4.5, 14.4), v3(0, 4.25, 8), easeOut(u));
  }],
  ["meB", (t, u) => { // from behind: the family walks on without him
    const d = t - C.meB;
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Sad", t); actors.zero.face("sad"); actors.zero.number(0, "#9aa0b4", 1.0);
    [["zip", -3.4, 10], ["luna", 0, 9], ["zeebra", 3.4, 7]].forEach(([k, x, n], i) => {
      actors[k].place(x, 19 + d * 4.2 + i * 0.8); actors[k].pose("Walk", t * 1.15 + i * 0.3); actors[k].face("happy"); actors[k].number(n, i ? "#ffffff" : "#ffd23c");
    });
    cam(t, v3(3.5, 7.2, -3.5), v3(0, 4.2, 15), v3(2.6, 8.2, -6), v3(0, 4.4, 17), smooth(u));
  }],
  ["night", (t, u) => { // dusk snaps to night, numbers start to fall
    crowdWalk(t, { drop: M.dropStart, stopAt: M.dropStart - 0.1 });
    cam(t, v3(0, 10, 46), v3(0, 9, -30), v3(0, 6.4, 33), v3(0, 8, -30), smooth(u), t > M.dropStart ? 0.05 : 0);
  }],
  ...[["zip", 10, 10, 0, -2], ["luna", 9, 6, 6, 4], ["zeebra", 7, 3, -6, 2]].map(([k, from, to, x, z], i) => [
    "count" + (i + 1), (t, u) => {
      const a = actors[k], hy = 5.3 * a.def.scale;
      a.place(x, z); a.pose("Shock", t - C["count" + (i + 1)] + 0.1); a.face("shock");
      a.number(to, "#ff5a4a", 1.05 + 0.25 * (1 - easeOut(u)), 0.07 * Math.sin(t * 70), 0.75);
      cam(t, v3(x + 1.2, hy - 0.4, z + 8.4), v3(x, hy + 0.9, z), v3(x + 0.8, hy - 0.3, z + 7.2), v3(x, hy + 1.0, z), easeOut(u), 0.06);
    }]),
  ["count4", (t, u) => {
    crowd.slice(0, 5).forEach((a, i) => {
      a.place(-8 + i * 4, 10 - (i % 2) * 3); a.pose("Shock", t - C.count4 + 0.1 - i * 0.04); a.face("shock");
      a.number(1, "#ff5a4a", 1.25, 0.1 * Math.sin(t * 70 + i));
    });
    cam(t, v3(0, 4.2, 25), v3(0, 5.6, 9), v3(0, 4.4, 21), v3(0, 5.8, 9), easeOut(u), 0.06);
  }],
  ["panicA", (t, u) => { // everyone runs at the lens
    const d = t - C.panicA;
    crowd.forEach((a, i) => {
      const w = WALK[i];
      a.place(w.x * 0.9, -30 + i * 3.4 + d * 15, 0.12 * Math.sin(i)); a.pose("Run", t * 1.6 + w.phase); a.face("shock");
      a.number(1, "#ff5a4a", 1, 0.06 * Math.sin(t * 60 + i));
    });
    cam(t, v3(0, 2.4, 34), v3(0, 4.6, 8), v3(0, 2.6, 31), v3(0, 4.8, 8), u, 0.14, 60);
  }],
  ["panicB", (t, u) => { // except me
    const d = t - C.panicA;
    crowd.forEach((a, i) => {
      const w = WALK[i], x = (w.x > 0 ? 1 : -1) * (3.6 + Math.abs(w.x) * 0.75);
      a.place(x, -62 + i * 4.2 + d * 15, 0); a.pose("Run", t * 1.6 + w.phase); a.face("shock"); a.number(1, "#ff5a4a");
    });
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Idle", t); actors.zero.face("neutral"); actors.zero.number(0, "#ffffff", 1.2);
    cam(t, v3(0, 4.1, 17.5), v3(0, 4.3, 8), v3(0, 4.15, 15.2), v3(0, 4.35, 8), easeOut(u), 0.03);
  }],
  ["up", (t, u) => { // low angle: his number climbs
    const k = Math.max(0, Math.floor((t - M.upStart) / 0.22) + 1), n = t < M.upStart ? 0 : Math.min(5, k);
    const beat = t < M.upStart ? 0 : 1 - clamp01(((t - M.upStart) % 0.22) / 0.22);
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Idle", t, "LookUp", smooth(clamp01(u * 3)));
    actors.zero.face(n > 0 ? "shock" : "neutral");
    actors.zero.number(n, n > 0 ? "#ffd23c" : "#ffffff", 1.05 + 0.3 * beat);
    cam(t, v3(1.8, 2.3, 14.6), v3(0, 4.7, 8), v3(1.3, 2.6, 13.4), v3(0, 4.9, 8), easeOut(u), 0, 60);
  }],
  ["cliffA", (t, u) => { // the tower names him
    board.material.map = boardTexes.zero;
    actors.zero.place(0, -47, Math.PI); actors.zero.pose("LookUp", t); actors.zero.face("shock"); actors.zero.number(null);
    cam(t, v3(0, 3.6, -33), v3(0, 15, -71), v3(0, 5.2, -39.5), v3(0, 21, -71), smooth(u), 0.04);
  }],
  ["cliffB", (t, u) => { // last look
    actors.zero.place(Z.x, Z.z); actors.zero.pose("Shock", t - C.cliffB + 0.12); actors.zero.face("shock");
    actors.zero.number(null);
    cam(t, v3(0.5, 3.9, 16.5), v3(0, 4.05, 8), v3(0.2, 3.95, 13.4), v3(0, 4.1, 8), easeOut(u), 0.03);
  }],
];
const NIGHT_FROM = C.night;

function renderAt(t) {
  if (!board) return;
  t = Math.min(Math.max(t, 0), PLAN.duration - 1e-4);
  for (const k in actors) { actors[k].root.visible = false; actors[k].number(null); }
  for (const a of crowd) { a.root.visible = false; a.number(null); }
  board.material.map = t >= C.cliffA ? boardTexes.zero : boardTexes.list;
  setNight(t < NIGHT_FROM ? 0 : smooth(clamp01((t - NIGHT_FROM) / 0.9)));
  if (townMats.TowerLight) townMats.TowerLight.emissiveIntensity = t >= C.cliffA ? 2.2 + 1.8 * Math.sin((t - C.cliffA) * 14) : 0.6;
  let i = SHOTS.length - 1;
  while (i > 0 && t < C[SHOTS[i][0]]) i--;
  const start = C[SHOTS[i][0]], end = i + 1 < SHOTS.length ? C[SHOTS[i + 1][0]] : PLAN.duration;
  SHOTS[i][1](t, clamp01((t - start) / (end - start)));
  composer.render();
  // badges: refill depth from the 3D scene, then draw them on top of the graded frame
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
async function build() {
  await document.fonts.load('700 100px "Fredoka"');
  const loader = new GLTFLoader();
  const [charGltf, townGltf] = await Promise.all([
    loader.loadAsync("assets/character.glb"), loader.loadAsync("assets/town.glb"),
  ]);
  for (const c of charGltf.animations) clipDur[c.name] = c.duration;
  for (const k in CAST) actors[k] = makeActor(charGltf.scene, charGltf.animations, CAST[k]);
  const r = mulberry32(77);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  for (let i = 0; i < CROWD_N; i++) {
    crowd.push(makeActor(charGltf.scene, charGltf.animations, {
      hair: pick(["Zero", "Luna", "Zip", "Zero"]), scale: 0.92 + r() * 0.2, chest: "none",
      face: { blush: r() < 0.4 },
      col: { Skin: pick(SKINS), Shirt: pick(PALETTE), Pants: pick(["#2f3a56", "#3b3b46", "#5a4636", "#3f5a4a"]),
        Shoes: pick(["#f4f4f4", "#2b2b33", "#b23a48"]), Hair: pick(HAIRS), Acc: pick(PALETTE), HairStreak: "#ffffff" },
    }));
  }
  const town = townGltf.scene;
  town.scale.setScalar(TOWN_SCALE);
  town.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of [].concat(o.material)) townMats[m.name] = m;
    if (o.name === "BoardScreen") board = o;
  });
  boardTexes = { list: boardTex("list"), zero: boardTex("zero") };
  board.material = new THREE.MeshBasicMaterial({ map: boardTexes.list, color: new THREE.Color(1.5, 1.5, 1.5), fog: false });
  board.castShadow = false;
  scene.add(town);
  renderer.compile(scene, camera);
  renderAt(window.__hfThreeTime || 0);
}

window.addEventListener("hf-seek", (e) => renderAt(e.detail.time));
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady.pilot3d = build();
window.__pilotRenderAt = renderAt;
