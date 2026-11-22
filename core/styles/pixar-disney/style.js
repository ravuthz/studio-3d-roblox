// The "pixar-disney" style: soft, round, big-headed characters (assets/character.glb), a pastel
// cottage town under a clear morning sky, and a gentler grade. This file holds what the engine
// asks a style for: the face art, the model size, the skin material and the light.
import * as THREE from "three";

// A face is a decal wrapped around the front of a round head: 256 x 256, the eyes sit a little
// above the middle, the 3D button nose is at about (128, 152). Same expressions and options as
// the roblox style's faces.
const EYE_Y = 120, EYE_X = 58, NOSE_Y = 152;

/** o: { brow, iris, blush, lashes, mustache } */
function drawFace(g, expr, o = {}) {
  const brow = o.brow || "#3a2a22", iris = o.iris || "#7a4a22", ink = "#2a1c1a";
  g.lineCap = "round"; g.lineJoin = "round";
  const stroke = (pts, w, c = ink) => {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  const curve = (x0, y0, cx, cy, x1, y1, w, c = ink) => {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  };

  if (o.shade) { // living shadow: two glowing eyes on a dark body (o.shade = eye colour or true), nothing else
    const h = expr === "shock" ? 40 : expr === "sleep" ? 4 : expr === "angry" || expr === "smug" ? 14 : expr === "sad" ? 18 : 28;
    const tilt = expr === "angry" ? 0.45 : expr === "sad" ? -0.35 : 0;
    g.fillStyle = typeof o.shade === "string" ? o.shade : "#f2f0ff";
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(128 + s * EYE_X, EYE_Y, 26, h, -s * tilt, 0, Math.PI * 2); g.fill(); }
    if (expr === "shock") { g.beginPath(); g.ellipse(128, NOSE_Y + 44, 11, 15, 0, 0, Math.PI * 2); g.fill(); }
    else if (expr === "happy") { g.beginPath(); g.arc(128, NOSE_Y + 30, 22, 0, Math.PI); g.closePath(); g.fill(); }
    return;
  }
  // soft cheeks: every toy face has a little warmth, "blush" makes it stronger
  for (const s of [-1, 1]) {
    const x = 128 + s * 84, y = 176;
    const grad = g.createRadialGradient(x, y, 2, x, y, 30);
    grad.addColorStop(0, `rgba(255,105,120,${o.blush ? 0.42 : 0.2})`); grad.addColorStop(1, "rgba(255,105,120,0)");
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, 30, 0, Math.PI * 2); g.fill();
  }

  /** a big glossy eye. open 0..1 (how far the upper lid is up), look = [dx, dy], size = iris scale */
  const eye = (s, { open = 1, look = [0, 0], size = 1, squint = 0, rx = 36, ry = 41 } = {}) => {
    const x = 128 + s * EYE_X, y = EYE_Y;
    const top = y - ry + (1 - open) * ry * 2;      // where the upper lid sits
    const low = y + ry + 6 - squint * 30;          // where the lower lid sits (it rises in a smile)
    g.save();
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.clip();
    // the lids only cut the eye's shape: the skin below shows through, lit like the rest of the face
    g.beginPath(); g.moveTo(x - rx - 2, top); g.lineTo(x + rx + 2, top); g.lineTo(x + rx + 2, low);
    g.quadraticCurveTo(x, low - 16 * squint, x - rx - 2, low); g.closePath(); g.clip();
    g.fillStyle = "#fffdf8"; g.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    const ix = x - s * 3 + look[0], iy = y + 3 + look[1], ir = 27 * size;
    const ig = g.createRadialGradient(ix, iy + ir * 0.35, ir * 0.15, ix, iy, ir);
    ig.addColorStop(0, "#c98a4a"); ig.addColorStop(0.6, iris); ig.addColorStop(1, "#2a160c");
    g.fillStyle = ig; g.beginPath(); g.arc(ix, iy, ir, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#140c0a"; g.beginPath(); g.arc(ix, iy, ir * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(ix - 7, iy - 8, ir * 0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(ix + 7, iy + 8, ir * 0.14, 0, Math.PI * 2); g.fill();
    // shade under the upper lid
    const sh = g.createLinearGradient(0, y - ry, 0, y - ry + 22);
    sh.addColorStop(0, "rgba(70,40,40,0.45)"); sh.addColorStop(1, "rgba(70,40,40,0)");
    g.fillStyle = sh; g.fillRect(x - rx, y - ry, rx * 2, 22);
    g.restore();
    // lash line along the upper lid
    const half = open >= 1 ? rx : rx * Math.sqrt(Math.max(0.05, 1 - ((top - y) / ry) ** 2));
    g.strokeStyle = ink; g.lineWidth = 5;
    if (open >= 1) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94); g.stroke(); }
    else curve(x - half, top + 1, x, top - 4, x + half, top + 1, 5);
    const ly = open >= 1 ? y - ry * 0.3 : top;
    if (o.lashes) for (const d of [0, 0.5]) {
      const lx = x + s * (half - d * 6);
      stroke([[lx, ly - d * 8], [lx + s * 10, ly - 9 - d * 8]], 3.5);
    }
  };
  /** closed eye: a smiling arc (up = true) or a sleeping one */
  const shut = (s, up, w = 5) => {
    const x = 128 + s * EYE_X, y = EYE_Y + 6;
    curve(x - 24, y + (up ? 6 : -4), x, y + (up ? -20 : 12), x + 24, y + (up ? 6 : -4), w);
    if (o.lashes) stroke([[x + s * 24, y + (up ? 6 : -4)], [x + s * 32, y + (up ? 0 : 2)]], 3.5);
  };
  /** brow: inner end height a, outer end height b (pixels above the eye, bigger = higher) */
  const brows = (a, b, w = 7) => {
    for (const s of [-1, 1]) {
      const xi = 128 + s * (EYE_X - 20), xo = 128 + s * (EYE_X + 24), y = EYE_Y - 47;
      curve(xi, y - a, 128 + s * EYE_X, y - (a + b) / 2 - 5, xo, y - b, w, brow);
    }
  };
  const mouthY = NOSE_Y + 34;
  const open = (w, h, y = mouthY, teeth = true) => { // open mouth with a tongue
    g.save();
    g.beginPath(); g.moveTo(128 - w, y); g.quadraticCurveTo(128, y - 5, 128 + w, y);
    g.quadraticCurveTo(128 + w * 0.8, y + h, 128, y + h); g.quadraticCurveTo(128 - w * 0.8, y + h, 128 - w, y);
    g.closePath(); g.fillStyle = "#5a1a22"; g.fill(); g.clip();
    g.fillStyle = "#ff8f9c"; g.beginPath(); g.ellipse(128, y + h, w * 0.6, h * 0.45, 0, 0, Math.PI * 2); g.fill();
    if (teeth) { g.fillStyle = "#fffdf8"; g.fillRect(128 - w, y - 6, w * 2, 6 + h * 0.24); }
    g.restore();
  };

  if (expr === "happy") {
    eye(-1, { squint: 0.55 }); eye(1, { squint: 0.55 }); brows(4, 2);
    open(32, 30, mouthY - 6);
  } else if (expr === "shock") {
    eye(-1, { size: 0.78, ry: 43 }); eye(1, { size: 0.78, ry: 43 }); brows(14, 10, 6);
    g.fillStyle = "#5a1a22"; g.beginPath(); g.ellipse(128, mouthY + 10, 11, 14, 0, 0, Math.PI * 2); g.fill();
  } else if (expr === "sad") {
    eye(-1, { open: 0.8, look: [0, 5] }); eye(1, { open: 0.8, look: [0, 5] }); brows(10, -6);
    curve(108, mouthY + 14, 128, mouthY + 2, 148, mouthY + 14, 5);
  } else if (expr === "smug") {
    eye(-1, { open: 0.62, look: [6, 0] }); eye(1, { open: 0.62, look: [6, 0] }); brows(-2, 6);
    curve(108, mouthY + 6, 132, mouthY + 14, 152, mouthY - 2, 5);
  } else if (expr === "angry") {
    eye(-1, { open: 0.72 }); eye(1, { open: 0.72 }); brows(-14, 8, 9);
    open(19, 13, mouthY + 2);
  } else if (expr === "sleep") {
    shut(-1, false); shut(1, false); brows(0, 0, 6);
    curve(118, mouthY + 6, 128, mouthY + 10, 138, mouthY + 6, 5);
  } else {
    eye(-1); eye(1); brows(2, 2);
    curve(102, mouthY, 128, mouthY + 20, 154, mouthY, 5.5);
  }
  if (o.mustache) {
    g.fillStyle = o.mustache;
    g.beginPath(); g.ellipse(108, mouthY - 8, 24, 9, -0.2, 0, Math.PI * 2); g.ellipse(148, mouthY - 8, 24, 9, 0.2, 0, Math.PI * 2); g.fill();
  }
}

// This style's own light: a clear pastel morning instead of the roblox town's golden dusk, softer
// contrast and no grain; nights stay blue but brighter, so faces keep their colour.
const DAY = { top: new THREE.Color("#4fa8ee"), mid: new THREE.Color("#8fd0f7"), low: new THREE.Color("#d8effc") };
const NIGHT = { top: new THREE.Color("#141c52"), mid: new THREE.Color("#3a4a9a"), low: new THREE.Color("#7a6ab8") };
const _c = new THREE.Color();
const lerp = (a, b, u) => a + (b - a) * u;
/** called at the end of the engine's setEnv(night, green, red) */
function look({ skyU, scene, hemi, sun, bloom, grade, renderer, GREEN }, n, green, red) {
  for (const k of ["top", "mid", "low"]) skyU[k].value.lerpColors(DAY[k], NIGHT[k], n).lerp(GREEN[k], green);
  skyU.sunCol.value.set("#fff3d6").lerp(_c.set("#ff5a3a"), red * 0.6);
  scene.fog.color.set("#cfe9fa").lerp(_c.set("#232a66"), n).lerp(_c.set("#1c6a40"), green * 0.8);
  hemi.color.set("#f1f7ff").lerp(_c.set("#7a90e8"), n).lerp(_c.set("#7dffb0"), green * 0.7);
  hemi.groundColor.set("#f0d8b4").lerp(_c.set("#2a2850"), n);
  hemi.intensity = lerp(1.25, 1.0, n);
  sun.color.set("#fff0d4").lerp(_c.set("#9db4ff"), n).lerp(_c.set("#9dffb8"), green * 0.6);
  sun.intensity = lerp(2.5, 1.4, n);
  scene.environmentIntensity = lerp(0.6, 0.3, n);
  bloom.strength = lerp(0.16, 0.36, n);
  grade.uniforms.contrast.value = 0.27; grade.uniforms.split.value = 0.02; grade.uniforms.grain.value = 0;
  grade.uniforms.fringe.value = 0; grade.uniforms.sat.value = 1.2; grade.uniforms.vig.value = 0.16 + 0.35 * red;
  renderer.toneMappingExposure = lerp(0.98, 1.16, n);
}

export { drawFace };
export default {
  id: "pixar-disney",
  assets: "core/styles/pixar-disney/assets",
  dog: "core/styles/roblox/assets/dog.glb",   // no dog of its own yet: the roblox one
  size: 1.19,           // puts a face at the height of a roblox character's, so the same shots frame both
  headY: 6.1,           // top of the head, for the number badge
  drawFace,
  faceRoughness: 0.35,  // glossy eyes
  skinRoughness: 0.5,
  // a warm sheen at grazing angles: a cheap stand-in for light passing through skin
  skin: () => new THREE.MeshPhysicalMaterial({ sheen: 1, sheenColor: "#ff7a52", sheenRoughness: 0.45 }),
  look,
};
