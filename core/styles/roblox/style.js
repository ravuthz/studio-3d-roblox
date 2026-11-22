// The "roblox" style: blocky characters (assets/character.glb), the brick town at golden dusk and
// the engine's default light and grade. This file holds what the engine asks a style for.

// A face is a flat 256 x 256 decal on the front of the head.
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
  if (o.shade) { // living shadow: two glowing eyes on a dark body (o.shade = eye colour or true), no brows
    const col = typeof o.shade === "string" ? o.shade : "#f2f0ff";
    const h = expr === "shock" ? 24 : expr === "sleep" ? 3 : expr === "angry" || expr === "smug" ? 9 : expr === "sad" ? 11 : 15;
    const tilt = expr === "angry" ? 0.45 : expr === "sad" ? -0.35 : 0;
    g.fillStyle = col;
    for (const [x, s] of [[lx, 1], [rx, -1]]) { g.beginPath(); g.ellipse(x, ey, 15, h, s * tilt, 0, Math.PI * 2); g.fill(); }
    if (expr === "shock") { g.beginPath(); g.ellipse(128, 198, 11, 15, 0, 0, Math.PI * 2); g.fill(); }
    else if (expr === "happy") { g.beginPath(); g.arc(128, 180, 22, 0, Math.PI); g.closePath(); g.fill(); }
    return;
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
  } else if (expr === "sleep") { // closed eyes, small relaxed mouth
    arc(lx, ey - 6, 15, Math.PI * 0.15, Math.PI * 0.85, 7); arc(rx, ey - 6, 15, Math.PI * 0.15, Math.PI * 0.85, 7);
    line([[lx - 18, ey - 36], [lx + 16, ey - 38]], 6, brow); line([[rx - 16, ey - 38], [rx + 18, ey - 36]], 6, brow);
    g.fillStyle = "#3a1220"; g.beginPath(); g.ellipse(128, 186, 8, 6, 0, 0, Math.PI * 2); g.fill();
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

export { drawFace };
export default {
  id: "roblox",
  assets: "core/styles/roblox/assets",
  dog: "core/styles/roblox/assets/dog.glb",
  size: 1,              // model scale
  headY: 5.3,           // top of the head, for the number badge
  drawFace,
  faceRoughness: 0.9,
  skinRoughness: 0.62,
  skin: null,           // skin uses the model's own material
  look: null,           // the engine's own light and grade
};
