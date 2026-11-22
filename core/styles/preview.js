// Style check for a style's character (see preview.html): one canvas, many small views.
// ?sheet=card draws the 640 x 640 thumbnail saved as <style>/preview.png for the Film Studio.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { resolveStyle } from "./index.js";

const q = new URLSearchParams(location.search);
const style = resolveStyle(q.get("style"));
const W = 1920, H = 1280;
const CAST = {
  zero: { hair: "Zero", fit: ["Short", "Crew"], chest: "0", face: { blush: true, brow: "#27304f" },
    col: { Skin: "#f4cda6", Shirt: "#f3f3f6", Pants: "#2f3a56", Shoes: "#2ec4b6", Hair: "#27304f", Trim: "#2ec4b6" } },
};
const def = CAST[q.get("who") || "zero"];
const EXPRS = ["neutral", "happy", "shock", "sad", "smug", "angry", "sleep"];

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f6e7d8");
scene.add(new THREE.HemisphereLight("#fff1e2", "#c9a48c", 1.5));
const sun = new THREE.DirectionalLight("#ffd6a8", 2.2);
sun.position.set(-6, 10, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 10, bottom: -4, near: 1, far: 40 });
sun.shadow.radius = 8; sun.shadow.normalBias = 0.05;
const rim = new THREE.DirectionalLight("#fff3dc", 1.1); rim.position.set(5, 6, -8);
scene.add(sun, rim);
{ // soft studio sky for reflections (the same idea as the engine's)
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP);
      vec3 c = mix(vec3(0.3, 0.26, 0.24), vec3(1.0, 0.93, 0.86), smoothstep(-0.25, 0.05, d.y));
      c = mix(c, vec3(0.6, 0.74, 1.0), smoothstep(0.05, 0.8, d.y));
      c += vec3(3.0, 2.6, 2.0) * pow(max(dot(d, normalize(vec3(-0.6, 0.55, 0.5))), 0.0), 24.0);
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0.03).texture;
}
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: "#f0dcc8", roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const tex = (w, h, draw) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.flipY = false; return t;
};
const shade = (hex, k) => { const c = new THREE.Color(hex), o = {}; c.getHSL(o); return "#" + c.setHSL(o.h, o.s, Math.min(1, Math.max(0, o.l + k))).getHexString(); };

const gltf = await new GLTFLoader().loadAsync(`./${style.id}/assets/character.glb`);
const model = gltf.scene; model.scale.setScalar(style.size / 1.19); scene.add(model);
const c = def.col, fit = new Set(def.fit), short = fit.has("Short"), shorts = fit.has("Shorts");
const col = { HairStreak: "#ffffff", Acc: "#ffd23c", ...c, Sleeve: c.Shirt, Forearm: short ? c.Skin : c.Shirt, Cuff: c.Trim, Collar: c.Trim,
  Shin: shorts ? c.Skin : c.Pants, PantsHem: shade(c.Pants, -0.06), Sole: "#f4f1ea" };
const ROUGH = { Skin: 0.5, Hair: 0.45, Shoes: 0.4, Sole: 0.6 };
const faces = Object.fromEntries(EXPRS.map((e) => [e, tex(512, 512, (g) => { g.scale(2, 2); style.drawFace(g, e, def.face); })]));
const chestTex = tex(512, 512, (g) => {
  g.font = "900 380px Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#1c1f2b"; g.fillText(def.chest, 256, 250);
});
let faceMat;
model.traverse((o) => {
  if (!o.isMesh) return;
  o.frustumCulled = false;
  if (o.name.startsWith("M_Hair_")) o.visible = o.name.startsWith("M_Hair_" + def.hair);
  if (o.name.startsWith("M_Fit_")) o.visible = fit.has(o.name.split("_")[2]);
  const fix = (m) => {
    if (m.name === "Face" || m.name === "Chest") {
      const nm = new THREE.MeshStandardMaterial({ map: m.name === "Face" ? faces.neutral : chestTex, transparent: true, alphaTest: 0.04,
        roughness: m.name === "Face" ? style.faceRoughness : 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      if (m.name === "Face") faceMat = nm;
      return nm;
    }
    const skin = col[m.name] === c.Skin;
    const nm = skin && style.skin ? style.skin() : m.clone();
    nm.name = m.name;
    if (col[m.name]) nm.color.set(col[m.name]);
    nm.roughness = skin ? ROUGH.Skin : ROUGH[m.name] ?? 0.85; nm.metalness = 0;
    return nm;
  };
  o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  const decal = o.name === "M_Face" || o.name === "M_Chest";
  o.castShadow = !decal; o.receiveShadow = !decal;
});
const mixer = new THREE.AnimationMixer(model);
const actions = Object.fromEntries(gltf.animations.map((a) => [a.name, mixer.clipAction(a)]));
for (const k in actions) { actions[k].play(); actions[k].setEffectiveWeight(0); }
const pose = (name, time) => {
  for (const k in actions) actions[k].setEffectiveWeight(0);
  actions[name].time = time; actions[name].setEffectiveWeight(1); mixer.update(0);
};

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
/** render one cell: rect in pixels (top-left origin), view angle, framing */
function cell(x, y, w, h, { ry = 0, face = "neutral", clip = "Idle", time = 0, target = [0, 2.6, 0], dist = 13, up = 0.6 }) {
  pose(clip, time); faceMat.map = faces[face];
  model.rotation.y = ry;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.set(target[0], target[1] + up, target[2] + dist); camera.lookAt(...target);
  renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
  renderer.render(scene, camera);
}
if (q.get("sheet") === "card") {
  renderer.setSize(640, 640, false);
  pose("Wave", 0.3); faceMat.map = faces.happy; model.rotation.y = -0.35;
  camera.aspect = 1; camera.updateProjectionMatrix();
  camera.position.set(0, 3.3, 12.2); camera.lookAt(0, 2.75, 0);
  renderer.setViewport(0, 0, 640, 640); renderer.setScissor(0, 0, 640, 640);
  renderer.render(scene, camera);
} else if (q.get("sheet") === "poses") {
  const P = [["Idle", 0], ["Walk", 0.25], ["Run", 0.15], ["Wave", 0.3], ["Talk", 0.5], ["Cheer", 0.25], ["Sad", 0.5], ["Point", 0], ["Sit", 0], ["Shock", 1.2], ["HandsUp", 0], ["Reach", 0]];
  const F = { Cheer: "happy", Wave: "happy", Sad: "sad", Shock: "shock", Run: "happy" };
  P.forEach(([clip, time], i) => cell((i % 6) * 320, Math.floor(i / 6) * 640, 320, 640, { clip, time, face: F[clip] || "neutral", ry: -0.45, dist: 15.5, target: [0, 2.7, 0] }));
} else {
  [0, -0.75, -Math.PI / 2, Math.PI].forEach((ry, i) => cell(i * 480, 0, 480, 700, { ry, dist: 13.5 }));
  const cw = W / 7;
  EXPRS.forEach((face, i) => cell(i * cw, 700, cw, 580, { face, ry: i % 2 ? 0.3 : -0.3, target: [0, 3.9, 0], dist: 10.6, up: 0.25 }));
}
document.title = "ready";
