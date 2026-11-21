// Scene kit: room shells, palettes, mood lights and a library of placeable props.
// A kit scene is plain JSON in core/scenes/<id>.json (see AGENTS.md "Scene kit"). stage.js loads the
// layouts a film uses and calls buildKitScene(); films use it through useScene("<id>").
// Props are built at the origin facing +Z (toward the cameras) in studs; a person is about 5 tall.
import * as THREE from "three";
import { mulberry32 } from "./textures.js";

const PI = Math.PI;

// ------------------------------------------------------------------ palettes
// A palette value is a plain colour "#rrggbb" or [surface, colour]. Surfaces are the texture kinds in
// textures.js (planks, plaster, brick, grain, tiles, checker, carpet, fabric, leaves, grass, pavers,
// asphalt, stone, rock, siding, shingles) plus smooth "polish" and "metal". A layout picks a base palette
// and may override any key: "palette": { "base": "school", "wall": ["plaster", "#f3e7c9"] }.
export const PALETTES = {
  home: {
    floor: ["planks", "#c08c5c"], wall: ["plaster", "#f2dcc0"], wall2: ["plaster", "#d6e3cf"], ceiling: ["plaster", "#f6efe4"],
    trim: "#fbf6ee", wood: ["grain", "#7d5136"], woodL: ["grain", "#c99868"], fabric: ["fabric", "#4c7c8a"], fabric2: ["fabric", "#5d91a0"],
    accent: "#e8b04a", accent2: "#d9664f", metal: ["metal", "#d9dee4"], dark: "#2a2d36", leaf: ["leaves", "#4f8a4a"], pot: "#c4643f",
    rug: ["carpet", "#a9483f"], ground: ["grass", "#6fa65a"], path: ["pavers", "#d8cbb2"], board: "#2f5d4a", glass: "#cfe2e0", lamp: "#ffd9a0",
  },
  cafe: {
    floor: ["checker", "#f1e6d4"], wall: ["brick", "#b86a4e"], wall2: ["plaster", "#f0dcc2"], ceiling: ["grain", "#4d3527"],
    trim: "#2f5d55", wood: ["grain", "#6a432e"], woodL: ["grain", "#b8865c"], fabric: ["fabric", "#2f6f68"], fabric2: ["fabric", "#c4553f"],
    accent: "#c9a063", accent2: "#e76f51", metal: ["metal", "#d5dae0"], dark: "#24262c", leaf: ["leaves", "#4f8a4a"], pot: "#c4643f",
    rug: ["carpet", "#7a3b30"], ground: ["pavers", "#9a9690"], path: ["pavers", "#b8b2a8"], board: "#1f2b26", glass: "#cfe2e0", lamp: "#ffd59a",
  },
  park: {
    floor: ["pavers", "#d8cbb2"], wall: ["brick", "#a86a52"], wall2: ["plaster", "#efe4d0"], ceiling: ["plaster", "#f6efe4"],
    trim: "#f4efe6", wood: ["grain", "#8a5a3a"], woodL: ["grain", "#c99868"], fabric: ["fabric", "#d9664f"], fabric2: ["fabric", "#e8b04a"],
    accent: "#e9c46a", accent2: "#e76f51", metal: ["metal", "#3a4a44"], dark: "#262b2a", leaf: ["leaves", "#4f8a4a"], pot: "#b8643f",
    rug: ["carpet", "#a9483f"], ground: ["grass", "#6fa65a"], path: ["pavers", "#d8cbb2"], board: "#2f5d4a", glass: "#bfe0ea", lamp: "#ffd9a0",
  },
  school: {
    floor: ["checker", "#e4e0d4"], wall: ["plaster", "#f3e7c9"], wall2: ["plaster", "#a9cbd6"], ceiling: ["plaster", "#f7f4ec"],
    trim: "#ffffff", wood: ["grain", "#a8754c"], woodL: ["grain", "#d9b48a"], fabric: ["fabric", "#3d5a80"], fabric2: ["fabric", "#e76f51"],
    accent: "#2a9d8f", accent2: "#e76f51", metal: ["metal", "#9fb0bc"], dark: "#2b3038", leaf: ["leaves", "#4f8a4a"], pot: "#c4643f",
    rug: ["carpet", "#3d5a80"], ground: ["grass", "#6fa65a"], path: ["pavers", "#cfc4b0"], board: "#2f5d4a", glass: "#cfe2e0", lamp: "#fff0d0",
  },
  mall: {
    floor: ["tiles", "#ece6dc"], wall: ["plaster", "#f4efe8"], wall2: ["plaster", "#d8e2ea"], ceiling: ["plaster", "#f7f7f4"],
    trim: "#ffffff", wood: ["grain", "#9a6a46"], woodL: ["grain", "#c99868"], fabric: ["fabric", "#2a9d8f"], fabric2: ["fabric", "#e76f51"],
    accent: "#e76f51", accent2: "#2a9d8f", metal: ["metal", "#cfd5de"], dark: "#2a2d36", leaf: ["leaves", "#4f8a4a"], pot: "#3f5f7a",
    rug: ["carpet", "#3d5a80"], ground: ["pavers", "#c8c2b8"], path: ["pavers", "#d8d2c8"], board: "#1f2b26", glass: "#cfe6ee", lamp: "#ffe6c0",
  },
};
const SURF = {
  planks: "KitPlanks", plaster: "KitPlaster", brick: "KitBrick", grain: "KitGrain", tiles: "KitTiles", checker: "KitChecker",
  carpet: "KitCarpet", fabric: "KitFabric", leaves: "KitLeaf", grass: "KitGrass", pavers: "KitPavers", asphalt: "KitAsphalt",
  stone: "KitStone", rock: "KitRock", siding: "KitSiding", shingles: "KitShingles", polish: "KitPolish", metal: "KitMetal",
};

// ------------------------------------------------------------------ small mesh helpers
const shadowy = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };
const noShadow = (m) => { m.castShadow = false; return m; };
const leafCols = (hex) => { const c = new THREE.Color(hex); return [c.clone().offsetHSL(0, 0, -0.06), c.clone(), c.clone().offsetHSL(0.02, 0, 0.07)].map((x) => "#" + x.getHexString()); };
function drawText(g, w, h, text, fg, font = 0.42) {
  const lines = String(text).split("\n");
  let size = Math.round(h * font / Math.max(1, lines.length * 0.8));
  g.font = `700 ${size}px Fredoka, Arial Black, sans-serif`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  if (widest > w * 0.88) { size = Math.floor(size * (w * 0.88) / widest); g.font = `700 ${size}px Fredoka, Arial Black, sans-serif`; }
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1 + size * 0.04));
}

/**
 * Builds one kit scene. ctx comes from stage.js:
 *   studBox, surfMat(surface, colour), canvasTex(w, h, draw, flipY), windowMat(view),
 *   glow(colour, day, night) → emissive material that follows the mood,
 *   light(colour, [x, y, z] scene-local, day, night, dist) → warm practical light (max 6 per scene)
 * Returns { root, cams, seats, marks } in scene-local coordinates.
 */
export function buildKitScene(L, ctx) {
  const root = new THREE.Group();
  const base = PALETTES[L.palette?.base || (typeof L.palette === "string" ? L.palette : "home")] || PALETTES.home;
  const pal = { ...base, ...(typeof L.palette === "object" ? L.palette : {}) };
  delete pal.base;
  const shell = L.shell || { kind: "room" };
  const H = shell.height || 18;
  const cache = new Map();
  /** material from a palette key, a colour or [surface, colour] */
  const m = (spec) => {
    if (spec && typeof spec === "object" && !Array.isArray(spec) && spec.isMaterial) return spec;
    if (typeof spec === "string" && pal[spec] !== undefined) spec = pal[spec];
    const key = JSON.stringify(spec);
    if (cache.has(key)) return cache.get(key);
    let mat;
    if (Array.isArray(spec)) mat = ctx.surfMat(SURF[spec[0]] || "KitPlaster", spec[1]);
    else mat = new THREE.MeshStandardMaterial({ color: spec || "#cccccc", roughness: 0.7 });
    cache.set(key, mat); return mat;
  };
  const colorOf = (spec) => { if (typeof spec === "string" && pal[spec] !== undefined) spec = pal[spec]; return Array.isArray(spec) ? spec[1] : spec; };
  const P = {
    pal, m, colorOf, H,
    box: (w, h, d, mat, cast = true) => shadowy(ctx.studBox(w, h, d, m(mat)), cast),
    cyl: (rt, rb, h, mat, seg = 20) => shadowy(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m(mat))),
    ball: (r, mat, sx = 1, sy = 1, sz = 1) => { const b = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m(mat))); b.scale.set(sx, sy, sz); return b; },
    glow: (color, day = 0.4, night = 2.4) => ctx.glow(colorOf(color), day, night),
    pic: (w, h, draw, extra = {}) => new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: ctx.canvasTex(512, Math.max(32, Math.round(512 * h / w)), draw, true), fog: false, ...extra })),
    noShadow,
  };

  // a prop group: everything a prop adds goes into it; lights are moved to scene space
  function propGroup(x, y, z, ry, s) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s); g.updateMatrix();
    root.add(g);
    return {
      ...P, g,
      add: (mesh, px = 0, py = 0, pz = 0, pry = 0, prx = 0, prz = 0) => { mesh.position.set(px, py, pz); mesh.rotation.set(prx, pry, prz); g.add(mesh); return mesh; },
      light: (color, pos, day, night, dist = 30) => { const v = new THREE.Vector3(...pos).applyMatrix4(g.matrix); ctx.light(colorOf(color), [v.x, v.y, v.z], day, night, dist * s); },
      toScene: (pos) => new THREE.Vector3(...pos).applyMatrix4(g.matrix),
    };
  }

  // ---- shell
  if (shell.kind === "outdoor") {
    const [x0, x1] = shell.x || [-40, 40], [z0, z1] = shell.z || [-40, 40];
    const G = propGroup(0, 0, 0, 0, 1);
    G.add(G.box(420, 0.5, 420, shell.ground || "ground", false), (x0 + x1) / 2, -0.25, (z0 + z1) / 2);
    horizon(G, shell.horizon || [], x0, x1, z0, z1);
  } else {
    const [x0, x1] = shell.x || [-25, 25], [z0, z1] = shell.z || [-20, 28];
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const G = propGroup(0, 0, 0, 0, 1);
    const walls = { back: "wall", left: "wall", right: "wall", front: "wall", ...(shell.walls || {}) };
    G.add(G.box(w + 2, 0.5, d + 2, shell.floor || "floor", false), cx, -0.25, cz);
    const wall = (key, bw, bd, x, z) => { if (walls[key]) G.add(noShadow(G.box(bw, H, bd, walls[key])), x, H / 2, z); };
    wall("back", w + 2, 1, cx, z0 - 0.5); wall("front", w + 2, 1, cx, z1 + 0.5);
    wall("left", 1, d, x0 - 0.5, cz); wall("right", 1, d, x1 + 0.5, cz);
    if (shell.ceiling !== false) G.add(noShadow(G.box(w + 2, 1, d + 2, shell.ceilingColor || "ceiling")), cx, H + 0.5, cz);
    if (shell.beams) for (let z = z0 + 4; z < z1; z += 8) G.add(noShadow(G.box(w, 0.8, 0.9, "wood")), cx, H - 0.4, z);
    // baseboards and an optional lower band (wainscot) in another palette colour
    if (walls.back) G.add(noShadow(G.box(w, 0.8, 0.35, "trim")), cx, 0.4, z0 + 0.15);
    for (const [k, x] of [["left", x0 + 0.15], ["right", x1 - 0.15]]) if (walls[k]) G.add(noShadow(G.box(0.35, 0.8, d, "trim")), x, 0.4, cz);
    if (shell.wainscot) {
      const hb = shell.wainscotHeight || 3.2;
      if (walls.back) G.add(noShadow(G.box(w, hb, 0.25, shell.wainscot)), cx, hb / 2, z0 + 0.1);
      for (const [k, x] of [["left", x0 + 0.1], ["right", x1 - 0.1]]) if (walls[k]) G.add(noShadow(G.box(0.25, hb, d, shell.wainscot)), x, hb / 2, cz);
      if (walls.back) G.add(noShadow(G.box(w, 0.25, 0.45, "trim")), cx, hb + 0.1, z0 + 0.2);
      for (const [k, x] of [["left", x0 + 0.2], ["right", x1 - 0.2]]) if (walls[k]) G.add(noShadow(G.box(0.45, 0.25, d, "trim")), x, hb + 0.1, cz);
    }
    for (const o of shell.openings || []) opening(o, { x0, x1, z0, z1 });
  }

  /** window / door / doorway on a wall; "at" runs along the wall (x on back/front, z on left/right) */
  function opening(o, b) {
    const WALL = { back: [0, 0, b.z0, 0, 1], front: [0, 0, b.z1, PI, -1], left: [b.x0, 0, 0, PI / 2, -1], right: [b.x1, 0, 0, -PI / 2, 1] }[o.wall || "back"];
    const G = propGroup(WALL[0], 0, WALL[2], WALL[3], 1), a = (o.at || 0) * WALL[4];
    const trim = o.frame || "trim";
    if (o.type === "door" || o.type === "glassdoor" || o.type === "doorway") {
      const w = o.w || 5, h = o.h || 9.5;
      if (o.type === "doorway") G.add(G.box(w, h, 0.1, "#1c1e26", false), a, h / 2, 0.06);
      else if (o.type === "glassdoor") { const pane = G.add(new THREE.Mesh(new THREE.PlaneGeometry(w - 1, h - 1), ctx.windowMat(o.view || shell.view || "street")), a, h / 2, 0.12); pane.castShadow = false; }
      else {
        G.add(G.box(w, h, 0.3, o.color || "wood"), a, h / 2, 0.15);
        for (const yy of [h * 0.3, h * 0.72]) G.add(G.box(w * 0.7, h * 0.32, 0.08, o.color || "woodL"), a, yy, 0.32);
        G.add(G.ball(0.28, "accent"), a + w * 0.36, h * 0.48, 0.45);
      }
      for (const s of [-1, 1]) G.add(noShadow(G.box(0.6, h + 0.6, 0.6, trim)), a + s * (w / 2 + 0.3), (h + 0.6) / 2, 0.3);
      G.add(noShadow(G.box(w + 1.8, 0.6, 0.6, trim)), a, h + 0.3, 0.3);
      if (o.type === "glassdoor") G.add(G.box(0.3, 0.25, 1.2, "accent"), a + w * 0.36, h * 0.45, 0.3);
      return;
    }
    // window with a backdrop (garden or street) that follows the mood
    const w = o.w || 10, h = o.h || 7, y = o.y || 9;
    const pane = G.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), ctx.windowMat(o.view || shell.view || "garden")), a, y, 0.08); pane.castShadow = false;
    G.add(noShadow(G.box(w + 1.2, 0.6, 0.5, trim)), a, y + h / 2 + 0.3, 0.25);
    G.add(noShadow(G.box(w + 1.2, 0.6, 0.5, trim)), a, y - h / 2 - 0.3, 0.25);
    for (const s of [-1, 1]) G.add(noShadow(G.box(0.6, h, 0.5, trim)), a + s * (w / 2 + 0.3), y, 0.25);
    const nx = o.panes || Math.max(1, Math.round(w / 7));
    for (let i = 1; i < nx; i++) G.add(noShadow(G.box(0.32, h, 0.3, trim)), a - w / 2 + (i * w) / nx, y, 0.2);
    G.add(noShadow(G.box(w, 0.32, 0.3, trim)), a, y + h * 0.18, 0.2);
    G.add(G.box(w + 2, 0.4, 1.3, trim), a, y - h / 2 - 0.55, 0.6);
    if (o.curtains) for (const s of [-1, 1]) G.add(G.box(2.6, h + 3, 0.6, o.curtains), a + s * (w / 2 + 1.7), y - 0.7, 1.1);
  }

  /** far scenery around an outdoor scene: "trees", "city", "hills" */
  function horizon(G, kinds, x0, x1, z0, z1) {
    const r = mulberry32(L.seed || 7);
    if (kinds.includes("hills")) for (let i = 0; i < 9; i++) G.add(G.ball(30 + r() * 20, "ground", 1.6, 0.35, 1), x0 - 80 + i * ((x1 - x0 + 160) / 8), -2, z0 - 90 - r() * 30);
    if (kinds.includes("city")) {
      const cols = ["#d98b5f", "#7aa0b8", "#e3c27a", "#9b6f8f", "#6f9a7a", "#c9b8a0"];
      for (let x = x0 - 70; x < x1 + 70; x += 14 + r() * 6) {
        const h = 18 + r() * 34, w = 11 + r() * 5, z = z0 - 62 - r() * 20;
        G.add(G.box(w, h, 10, cols[Math.floor(r() * cols.length)]), x, h / 2, z);
        const lit = P.glow("#ffd58a", 0.0, 1.6);
        for (let wy = 4; wy < h - 3; wy += 5) for (let wx = -w / 2 + 2.5; wx < w / 2 - 1.5; wx += 3.2) if (r() < 0.55) G.add(noShadow(new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.2), lit)), x + wx, wy, z + 5.05);
      }
    }
    if (kinds.includes("trees")) {
      const ring = [];
      for (let x = x0 - 20; x <= x1 + 20; x += 7 + r() * 5) ring.push([x, z0 - 10 - r() * 26]);
      for (let z = z0; z <= z1; z += 8 + r() * 5) { ring.push([x0 - 10 - r() * 18, z]); ring.push([x1 + 10 + r() * 18, z]); }
      ring.forEach(([x, z], i) => { const s = 1 + r() * 0.8; const T = propGroup(x, 0, z, r() * 6, s); (i % 4 === 3 ? PROPS.pine : PROPS.tree).build(T, { seed: i + 3 }); });
    }
  }

  // ---- props
  const seats = {};
  for (const [i, e] of (L.props || []).entries()) {
    const def = PROPS[e.prop];
    if (!def) { console.warn(`scene ${L.id}: unknown prop "${e.prop}"`); continue; }
    const ry = ((e.ry || 0) * PI) / 180, s = e.scale || 1;
    const G = propGroup(e.x || 0, e.y || 0, e.z || 0, ry, s);
    const o = { seed: i + 1, ...e };
    def.build(G, o);
    const slots = typeof def.seats === "function" ? def.seats(o) : def.seats || [];
    (e.seats || []).forEach((name, k) => {
      if (!name || !slots[k]) return;
      const [sx, sy, sz, sr] = slots[k], v = G.toScene([sx, sy, sz]);
      seats[name] = [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3), +(ry + sr).toFixed(4)];
    });
  }
  for (const [k, v] of Object.entries(L.seats || {})) seats[k] = [v[0], v[1], v[2], ((v[3] || 0) * PI) / 180];
  // mood light preset: indoor adds a soft ceiling fill at night (like the home set)
  const light = L.light || (shell.kind === "outdoor" ? "outdoor" : "indoor");
  if (light === "indoor") {
    const [x0, x1] = shell.x || [-25, 25], [z0, z1] = shell.z || [-20, 28];
    ctx.light(pal.lamp, [(x0 + x1) / 2, H - 4, (z0 + z1) / 2], 0, 10, 50);
  }
  for (const l of L.lamps || []) ctx.light(colorOf(l.color || "lamp"), [l.x, l.y, l.z], l.day ?? 2, l.night ?? 24, l.dist || 34);

  const marks = {};
  for (const [k, v] of Object.entries(L.marks || {})) marks[k] = [v[0], v[1], ((v[2] || 0) * PI) / 180];
  return { root, seats, marks, cams: L.cams || {} };
}

// ------------------------------------------------------------------ prop library
// Each prop: build(P, o) with o = the layout entry (x, z, ry, scale, color, color2 and prop options).
// seats: [[x, y, z, ry], ...] in prop space, named in the layout with "seats": ["kai", "nova"].
function potted(P, x, z, k, pot, leaf, seed, tall = 1, y = 0) {
  const r = mulberry32(seed), cols = leafCols(P.colorOf(leaf));
  const leafM = cols.map((c) => P.m(["leaves", c]));
  P.add(P.cyl(0.95 * k, 0.72 * k, 1.7 * k, pot), x, y + 0.85 * k, z);
  P.add(P.cyl(0.86 * k, 0.86 * k, 0.12 * k, "#3b2a20"), x, y + 1.68 * k, z);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39, rr = (0.3 + 0.6 * r()) * k, h = (2.2 + (i / 9) * 3.2 * tall) * k;
    P.add(P.ball((0.85 + 0.5 * r()) * k, leafM[i % 3], 1.1, 0.8, 1.1), x + Math.cos(a) * rr, y + h, z + Math.sin(a) * rr, r() * 3);
  }
}
const ART = [
  (g, w, h) => { g.fillStyle = "#f3e2c3"; g.fillRect(0, 0, w, h); g.fillStyle = "#e07a4f"; g.beginPath(); g.arc(w / 2, h * 0.42, w * 0.22, 0, 7); g.fill(); g.fillStyle = "#2a9d8f"; g.fillRect(0, h * 0.62, w, h); g.fillStyle = "#264653"; g.fillRect(0, h * 0.8, w, h); },
  (g, w, h) => { g.fillStyle = "#264653"; g.fillRect(0, 0, w, h); g.fillStyle = "#e9c46a"; g.fillRect(w * 0.18, h * 0.18, w * 0.64, h * 0.64); g.fillStyle = "#e76f51"; g.fillRect(w * 0.33, h * 0.33, w * 0.34, h * 0.34); },
  (g, w, h) => { g.fillStyle = "#e9e1d0"; g.fillRect(0, 0, w, h); ["#e76f51", "#2a9d8f", "#e9c46a", "#264653"].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(w * (0.16 + i * 0.23), h / 2, Math.min(w, h) * 0.18, 0, 7); g.fill(); }); },
  (g, w, h) => { g.fillStyle = "#2f5d55"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.26, 0, 7); g.fill(); g.fillStyle = "#2f5d55"; g.beginPath(); g.arc(w * 0.62, h * 0.44, w * 0.24, 0, 7); g.fill(); },
];

export const PROPS = {
  // ---------------- living room (from the home set)
  sofa: {
    seats: [[-4.2, 2.15, 0.6, 0], [0, 2.15, 0.6, 0], [4.2, 2.15, 0.6, 0]],
    build(P, o) {
      const s = o.color || "fabric", c = o.color2 || "fabric2";
      P.add(P.box(14, 1.3, 4.6, s), 0, 0.85, 0);
      for (let i = 0; i < 3; i++) { P.add(P.box(4.1, 0.65, 3.7, c), (i - 1) * 4.2, 1.83, 0.45); P.add(P.box(4.0, 2.5, 0.9, c), (i - 1) * 4.2, 3.35, -0.9, 0, -0.1); }
      P.add(P.box(14, 3.6, 1.1, s), 0, 2.9, -1.8);
      for (const sx of [-1, 1]) P.add(P.box(1.2, 2.5, 4.6, s), sx * 6.4, 1.45, 0);
      for (const [sx, sz] of [[-6.6, 2], [6.6, 2], [-6.6, -2], [6.6, -2]]) P.add(P.box(0.5, 0.4, 0.5, "wood"), sx, 0.2, sz);
      P.add(P.box(1.8, 1.8, 0.55, "accent"), -5.2, 3.05, -0.3, 0.35, 0, 0.18);
      P.add(P.box(1.7, 1.7, 0.55, "accent2"), 5.2, 3.0, -0.3, -0.35, 0, -0.18);
    },
  },
  armchair: {
    seats: [[0, 2.12, 0.3, 0]],
    build(P, o) {
      const s = o.color || "fabric", c = o.color2 || "fabric2";
      P.add(P.box(4.6, 1.3, 4.4, s), 0, 0.85, 0); P.add(P.box(3.4, 0.6, 3.4, c), 0, 1.8, 0.3);
      P.add(P.box(4.6, 3.4, 1.0, s), 0, 2.8, -1.8); for (const sx of [-1, 1]) P.add(P.box(0.9, 2.4, 4.4, s), sx * 2.15, 1.5, 0);
      P.add(P.box(1.5, 1.5, 0.5, "accent2"), 0, 3.0, -1.1, 0, -0.15);
    },
  },
  coffeeTable: {
    build(P, o) {
      P.add(P.box(7.5, 0.45, 3.8, o.color || "woodL"), 0, 1.75, 0); P.add(P.box(6.8, 0.2, 3.2, "wood"), 0, 0.55, 0);
      for (const [sx, sz] of [[-3.3, -1.5], [3.3, -1.5], [-3.3, 1.5], [3.3, 1.5]]) P.add(P.box(0.45, 1.6, 0.45, "wood"), sx, 0.8, sz);
      P.add(P.cyl(0.32, 0.28, 0.6, "#f4f1ea"), 1.8, 2.28, 0.5);
      P.add(P.box(1.8, 0.3, 1.3, "#2a9d8f"), -1.6, 2.13, -0.1, 0.2); P.add(P.box(1.6, 0.3, 1.2, "#e76f51"), -1.5, 2.43, 0, -0.1);
      P.add(P.cyl(0.9, 0.6, 0.5, "#ece6dc"), 0.4, 2.22, -0.7);
      for (const [dx, dz, c] of [[-0.3, 0, "#e94f37"], [0.3, 0.1, "#f2b632"], [0, -0.3, "#7cb342"]]) P.add(P.ball(0.35, c), 0.4 + dx, 2.6, -0.7 + dz);
    },
  },
  floorLamp: {
    build(P, o) {
      P.add(P.cyl(0.9, 1.0, 0.25, "dark"), 0, 0.13, 0); P.add(P.cyl(0.12, 0.12, 8.6, "dark"), 0, 4.4, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 1.9, 20), P.glow(o.color || "lamp", 0.15, 1.3))), 0, 9.2, 0);
      if (o.light !== false) P.light(o.color || "lamp", [0, 8.0, 1.5], 3, 34, 34);
    },
  },
  tv: {
    build(P, o) {
      P.add(P.box(11, 2.4, 2.6, "wood"), 0, 1.2, 0); P.add(P.box(8.8, 5.2, 0.5, "dark"), 0, 6.6, -0.6);
      P.add(P.pic(8.2, 4.6, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#3a86c8"); gr.addColorStop(1, "#1d4f8a"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = "#7bc96f"; g.fillRect(0, h * 0.72, w, h); if (o.text) drawText(g, w, h * 0.6, o.text, "#ffffff", 0.3);
      }), 0, 6.6, -0.33);
      for (const dx of [-4.6, 4.6]) P.add(P.box(1.2, 1.8, 1.4, "dark"), dx, 3.3, 0);
    },
  },
  bookshelf: {
    build(P, o) {
      const r = mulberry32(o.seed * 7 + 61), cols = ["#e76f51", "#2a9d8f", "#e9c46a", "#264653", "#f4a261", "#8a5a9a", "#d6d0c4"];
      const w = o.w || 7.6, wood = o.color || "wood";
      for (const sx of [-1, 1]) P.add(P.box(0.4, 12, 2.2, wood), sx * (w / 2 + 0.2), 6, 0);
      P.add(P.box(w, 12, 0.2, wood), 0, 6, -1.0);
      for (let s = 0; s < 5; s++) {
        const y = 0.3 + s * 2.85; P.add(P.box(w, 0.3, 2.2, wood), 0, y, 0);
        if (s === 4) break;
        let x = -w / 2 + 0.3;
        while (x < w / 2 - 0.6) { const bw = 0.35 + r() * 0.35, bh = 1.6 + r() * 0.9; P.add(P.box(bw, bh, 1.6, cols[Math.floor(r() * 7)]), x + bw / 2, y + 0.15 + bh / 2, 0.1); x += bw + 0.05; }
      }
    },
  },
  rug: {
    build(P, o) {
      const w = o.w || 20, d = o.d || 13.5;
      P.add(P.box(w, 0.08, d, o.color || "rug", false), 0, 0.04, 0);
      P.add(P.box(w * 0.87, 0.1, d * 0.81, o.color2 || ["carpet", "#ead2ab"], false), 0, 0.05, 0);
    },
  },
  plant: { build(P, o) { potted(P, 0, 0, o.size || 1, o.color2 || "pot", o.color || "leaf", o.seed * 13 + 1, o.tall || 1); } },
  diningTable: {
    seats: [[-2.5, 2.12, -3.0, 0], [2.5, 2.12, -3.0, 0], [-6.2, 2.12, 0, PI / 2], [6.2, 2.12, 0, -PI / 2]],
    build(P, o) {
      P.add(P.box(10, 0.45, 5, o.color || "woodL"), 0, 2.85, 0);
      for (const [sx, sz] of [[-4.3, -2], [4.3, -2], [-4.3, 2], [4.3, 2]]) P.add(P.box(0.5, 2.65, 0.5, "wood"), sx, 1.32, sz);
      P.add(P.box(8.8, 0.04, 1.4, "rug", false), 0, 3.1, 0);
      for (const [px, pz] of [[-2.5, -1.8], [2.5, -1.8], [-4.2, 0], [4.2, 0]]) P.add(P.cyl(0.75, 0.6, 0.1, "#f4f1ea"), px, 3.12, pz);
      if (o.chairs !== false) for (const [x, z, ry] of [[-2.5, -2.9, 0], [2.5, -2.9, 0], [-6.1, 0, PI / 2], [6.1, 0, -PI / 2]]) { const C = sub(P, x, z, ry); PROPS.chair.build(C, {}); }
    },
  },
  chair: {
    seats: [[0, 2.12, -0.1, 0]],
    build(P, o) {
      const w = o.color || "wood";
      P.add(P.box(2.3, 0.35, 2.3, w), 0, 1.95, 0);
      for (const [sx, sz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) P.add(P.box(0.3, 1.8, 0.3, w), sx, 0.9, sz);
      P.add(P.box(2.3, 0.4, 0.3, w), 0, 4.6, -1.0); for (const sx of [-0.9, 0, 0.9]) P.add(P.box(0.25, 2.6, 0.25, w), sx, 3.3, -1.0);
    },
  },
  counter: { // kitchen run against a wall: len, sink, stove
    build(P, o) {
      const len = o.len || 17, cab = o.color || ["plaster", "#86a890"];
      P.add(P.box(len, 3.0, 3.2, cab), 0, 1.5, 0);
      P.add(P.box(len + 0.6, 0.35, 3.7, o.color2 || ["polish", "#f1ece4"]), 0, 3.17, 0.2);
      const n = Math.max(2, Math.round(len / 2.8));
      for (let i = 0; i <= n; i++) P.add(P.box(0.06, 2.6, 0.05, "dark"), -len / 2 + (i * len) / n, 1.6, 1.62);
      for (let i = 0; i < n; i++) P.add(P.box(0.5, 0.14, 0.18, "metal"), -len / 2 + (i + 0.5) * len / n, 2.5, 1.68);
      if (o.stove !== false) {
        P.add(P.box(3.4, 0.12, 2.6, "dark"), -len / 2 + 3.6, 3.41, 0.2);
        for (const [dx, dz] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) P.add(P.cyl(0.5, 0.5, 0.06, "#555a66"), -len / 2 + 3.6 + dx, 3.5, 0.2 + dz);
      }
      if (o.sink !== false) { P.add(P.box(3.0, 0.08, 2.0, "metal"), len / 2 - 4, 3.36, 0.1); P.add(P.cyl(0.1, 0.1, 1.3, "metal"), len / 2 - 4, 4.0, -0.9); }
      P.add(P.cyl(1.0, 0.7, 0.55, "#ece6dc"), 1, 3.62, -0.2);
      for (const [dx, c] of [[-0.35, "#f2b632"], [0.3, "#e94f37"], [0, "#7cb342"]]) P.add(P.ball(0.38, c), 1 + dx, 4.0, -0.2);
    },
  },
  fridge: {
    build(P, o) {
      P.add(P.box(4.6, 8.8, 3.8, o.color || "metal"), 0, 4.4, 0);
      P.add(P.box(4.6, 0.06, 0.05, "dark"), 0, 6.0, 1.92);
      P.add(P.box(0.22, 1.5, 0.28, "dark"), -1.85, 7.3, 2.05); P.add(P.box(0.22, 2.6, 0.28, "dark"), -1.85, 3.9, 2.05);
      for (const [dx, dy, c] of [[-0.9, 4.95, "#e94f37"], [0.9, 4.95, "#2a9d8f"], [0.4, 7.6, "#f2b632"], [-0.6, 7.2, "#8a5a9a"]]) P.add(P.box(0.35, 0.35, 0.12, c), dx, dy, 1.97);
    },
  },
  // ---------------- cafe (from the cafe set)
  twoTop: { // table with a front panel: two people side by side behind it face the room, legs hidden
    seats: [[-2.2, 2.08, -2.1, 0.22], [2.2, 2.08, -2.1, -0.22]],
    build(P, o) {
      P.add(P.box(8.6, 0.25, 3.2, o.color || ["polish", "#f3efe8"]), 0, 2.93, 0);
      P.add(P.box(8.2, 1.3, 0.2, o.color2 || "wood"), 0, 2.15, 1.45);
      for (const sx of [-1, 1]) P.add(P.box(0.35, 2.8, 2.6, "dark"), sx * 3.9, 1.4, 0);
      for (const [x, ry] of [[-2.2, 0.22], [2.2, -0.22]]) PROPS.bistroChair.build(sub(P, x, -2.1, ry), {});
      if (o.cups !== false) for (const [dx, c] of [[-2.2, "#f6efe2"], [2.2, "#e9c46a"]]) { P.add(P.cyl(0.34, 0.28, 0.55, c), dx, 3.33, -0.3); P.add(P.cyl(0.55, 0.55, 0.05, "#f6efe2"), dx, 3.07, -0.3); }
    },
  },
  bistroTable: {
    build(P, o) {
      const r = o.r || 1.8;
      P.add(P.cyl(r, r, 0.2, o.color || ["polish", "#f3efe8"], 28), 0, 2.95, 0); P.add(P.cyl(0.2, 0.2, 2.8, "dark", 10), 0, 1.45, 0); P.add(P.cyl(1.0, 1.05, 0.15, "dark"), 0, 0.08, 0);
      if (o.cup) P.add(P.cyl(0.34, 0.28, 0.55, "#f6efe2"), 0.3, 3.33, 0.2);
    },
  },
  bistroChair: {
    seats: [[0, 2.08, 0, 0]],
    build(P, o) {
      P.add(P.cyl(1.0, 1.0, 0.25, o.color || "wood"), 0, 1.95, 0);
      for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) P.add(P.cyl(0.09, 0.09, 1.9, "dark", 6), sx, 0.95, sz);
      P.add(P.box(1.9, 0.35, 0.25, o.color || "wood"), 0, 4.0, -0.9); P.add(P.box(1.9, 0.3, 0.25, o.color || "wood"), 0, 3.1, -0.9);
      for (const sx of [-0.85, 0.85]) P.add(P.box(0.2, 2.2, 0.2, "dark"), sx, 3.0, -0.9);
    },
  },
  stool: {
    seats: [[0, 3.25, 0, 0]],
    build(P, o) {
      P.add(P.cyl(0.95, 0.95, 0.3, o.color || "fabric2"), 0, 3.1, 0); P.add(P.cyl(0.12, 0.12, 3.0, "accent", 8), 0, 1.5, 0);
      P.add(P.cyl(0.8, 0.9, 0.12, "dark"), 0, 0.06, 0);
      P.add(shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 16), P.m("accent"))), 0, 1.2, 0, 0, PI / 2);
    },
  },
  cafeCounter: { // service counter with espresso machine, register and a cupcake stand
    build(P, o) {
      const len = o.len || 18;
      P.add(P.box(len, 3.4, 3.4, o.color || "wood"), 0, 1.7, 0);
      for (let i = 0; i < Math.floor(len / 3); i++) P.add(P.box(2.6, 2.5, 0.12, "woodL"), -len / 2 + 1.5 + i * 3, 1.75, 1.75);
      P.add(P.box(len + 0.6, 0.35, 4.0, o.color2 || "#2e2c31"), 0, 3.57, 0);
      P.add(P.box(3.4, 2.4, 2.1, "metal"), len / 2 - 4.2, 4.95, -0.6); P.add(P.box(3.6, 0.3, 2.3, "dark"), len / 2 - 4.2, 6.3, -0.6);
      P.add(P.box(1.8, 1.0, 1.4, "dark"), -len / 2 + 4.2, 4.25, -0.4, 0.2, -0.3);
      for (const [y, r] of [[3.85, 1.3], [4.75, 0.95], [5.55, 0.6]]) P.add(P.cyl(r, r, 0.1, "#f6efe2"), -0.2, y, 0.2);
      P.add(P.cyl(0.08, 0.08, 1.8, "accent", 8), -0.2, 4.7, 0.2);
      for (const [i, c] of ["#f4a6c0", "#ffe08a", "#c79566", "#a4d4c5", "#f4a6c0"].entries()) {
        const a = i * 1.25, y = i < 3 ? 3.9 : 4.8, rr = i < 3 ? 0.85 : 0.55;
        P.add(P.ball(0.33, c, 1, 0.7, 1), -0.2 + Math.cos(a) * rr, y + 0.4, 0.2 + Math.sin(a) * rr);
      }
    },
  },
  pendant: { // hanging lamp; y = bulb height (default 3.5 under the ceiling)
    build(P, o) {
      const yb = (o.bulb || P.H - 4.5), cord = Math.max(0.5, P.H - yb - 0.6);
      P.add(P.noShadow(P.cyl(0.04, 0.04, cord, "dark", 6)), 0, yb + 0.5 + cord / 2, 0);
      P.add(P.noShadow(P.cyl(0.4, 1.0, 0.9, o.color || "accent")), 0, yb + 0.5, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), P.glow("lamp", 1.0, 2.6))), 0, yb, 0);
      if (o.light) P.light("lamp", [0, yb - 1.5, 0], 4, 26, 30);
    },
  },
  stringLights: { // a sagging line of bulbs along x: len, y (height), sag
    build(P, o) {
      const len = o.len || 20, y = o.h || 9, sag = o.sag ?? 1.4, n = Math.max(6, Math.round(len / 2.4));
      const bulb = P.glow(o.color || "#ffe0a0", 0.5, 3.0), cord = P.m("#2a2420");
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const x = -len / 2 + (len * i) / n, yy = y - sag * Math.sin((PI * i) / n);
        P.add(P.noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), bulb)), x, yy - 0.25, 0);
        if (prev) { const [x0, y0] = prev, l = Math.hypot(x - x0, yy - y0); P.add(P.noShadow(new THREE.Mesh(new THREE.BoxGeometry(l, 0.05, 0.05), cord)), (x + x0) / 2, (yy + y0) / 2, 0, 0, 0, Math.atan2(yy - y0, x - x0)); }
        prev = [x, yy];
      }
      if (o.poles) for (const sx of [-1, 1]) { P.add(P.cyl(0.18, 0.22, y + 0.4, "dark", 8), sx * len / 2, (y + 0.4) / 2, 0); }
    },
  },
  art: { // framed picture on a wall, facing +Z: w, h, style 0..3
    build(P, o) {
      const w = o.w || 3.2, h = o.h || 4.2;
      P.add(P.box(w + 0.5, h + 0.5, 0.2, o.color || "wood"), 0, 0, 0);
      P.add(P.pic(w, h, ART[(o.style ?? o.seed) % ART.length]), 0, 0, 0.12);
    },
  },
  sign: { // flat sign with text facing +Z: w, h, text, color (background), color2 (text), glow
    build(P, o) {
      const w = o.w || 8, h = o.h || 2, bg = P.colorOf(o.color || "dark"), fg = P.colorOf(o.color2 || "#ffffff");
      P.add(P.box(w + 0.3, h + 0.3, 0.2, "dark"), 0, 0, -0.1);
      const pic = P.pic(w, h, (g, cw, ch) => {
        g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
        if (o.glow) { g.shadowColor = fg; g.shadowBlur = 24; }
        drawText(g, cw, ch, o.text || "", fg, 0.6);
      });
      P.add(pic, 0, 0, 0.02);
    },
  },
  box: { build(P, o) { P.add(P.box(o.w || 2, o.h || 2, o.d || 2, o.color || "woodL"), 0, (o.h || 2) / 2, 0); } },
  // ---------------- outdoor
  tree: {
    build(P, o) {
      const r = mulberry32((o.seed || 1) * 31 + 5), cols = leafCols(P.colorOf(o.color || "leaf")), k = o.size || 1;
      P.add(P.cyl(0.55 * k, 0.8 * k, 7 * k, o.color2 || "wood", 8), 0, 3.5 * k, 0);
      for (let i = 0; i < 6; i++) {
        const a = i * 2.1 + r(), rr = i ? (1.6 + r()) * k : 0;
        P.add(P.ball((2.6 + r() * 1.2) * k, ["leaves", cols[i % 3]], 1.1, 0.9, 1.1), Math.cos(a) * rr, (8.4 + r() * 2.2 + (i ? 0 : 1.6)) * k, Math.sin(a) * rr, r() * 3);
      }
    },
  },
  pine: {
    build(P, o) {
      const k = o.size || 1, cols = leafCols(P.colorOf(o.color || ["leaves", "#3d7543"]));
      P.add(P.cyl(0.45 * k, 0.6 * k, 4 * k, o.color2 || "wood", 8), 0, 2 * k, 0);
      for (let i = 0; i < 4; i++) P.add(P.cyl(0.2 * k, (3.6 - i * 0.75) * k, 3.4 * k, ["leaves", cols[i % 3]], 8), 0, (4.2 + i * 2.2) * k, 0, i);
    },
  },
  bush: {
    build(P, o) {
      const r = mulberry32((o.seed || 1) * 17), cols = leafCols(P.colorOf(o.color || "leaf")), k = o.size || 1;
      for (let i = 0; i < 5; i++) P.add(P.ball((1.1 + r() * 0.5) * k, ["leaves", cols[i % 3]], 1.2, 0.85, 1.2), (r() - 0.5) * 2.4 * k, (1.0 + r() * 0.6) * k, (r() - 0.5) * 1.6 * k);
    },
  },
  hedge: { // trimmed hedge along x: len, h — good cover in front of a bench
    build(P, o) {
      const len = o.len || 8, h = o.h || 2.6, cols = leafCols(P.colorOf(o.color || "leaf")), r = mulberry32((o.seed || 1) * 19);
      P.add(P.box(len, h, 1.8, ["leaves", cols[1]]), 0, h / 2, 0);
      for (let x = -len / 2 + 0.8; x <= len / 2 - 0.6; x += 1.4) P.add(P.ball(0.9 + r() * 0.2, ["leaves", cols[Math.floor(r() * 3)]], 1.1, 0.7, 1.4), x, h - 0.1, 0);
    },
  },
  flowerBed: {
    build(P, o) {
      const len = o.len || 6, r = mulberry32((o.seed || 1) * 23), cols = o.colors || ["#e94f37", "#f2b632", "#f4a6c0", "#ffffff", "#8a5a9a"];
      P.add(P.box(len, 0.8, 2.4, o.color2 || "wood"), 0, 0.4, 0); P.add(P.box(len - 0.4, 0.2, 2.0, ["rock", "#4a3426"], false), 0, 0.82, 0);
      for (let i = 0; i < len * 3; i++) { const x = -len / 2 + 0.4 + r() * (len - 0.8), z = (r() - 0.5) * 1.6; P.add(P.ball(0.42, ["leaves", "#4f8a4a"], 1, 0.7, 1), x, 1.1, z); P.add(P.ball(0.24, cols[i % cols.length]), x + 0.1, 1.5, z); }
    },
  },
  bench: { // park bench: len; cover: "hedge" | "planter" puts low cover in front so seated legs stay hidden
    seats: (o) => { const l = o.len || 7; return [[-l * 0.24, 2.05, 0.15, 0], [l * 0.24, 2.05, 0.15, 0]]; },
    build(P, o) {
      const len = o.len || 7, wood = o.color || "woodL", iron = o.color2 || "metal";
      for (let i = 0; i < 3; i++) P.add(P.box(len, 0.22, 0.62, wood), 0, 1.95, -0.75 + i * 0.75);
      for (let i = 0; i < 2; i++) P.add(P.box(len, 0.55, 0.18, wood), 0, 3.0 + i * 0.85, -1.3, 0, -0.18);
      for (const sx of [-1, 1]) {
        P.add(P.box(0.28, 1.85, 0.28, iron), sx * (len / 2 - 0.5), 0.92, 0.75); P.add(P.box(0.28, 4.3, 0.28, iron), sx * (len / 2 - 0.5), 2.15, -1.2, 0, -0.18);
        P.add(P.box(0.28, 0.24, 2.2, iron), sx * (len / 2 - 0.5), 2.8, -0.1);
      }
      if (o.cover === "hedge") PROPS.hedge.build(sub(P, 0, 2.6, 0), { len: len + 1, h: 1.7, seed: o.seed, color: o.coverColor });
      if (o.cover === "planter") PROPS.planter.build(sub(P, 0, 2.7, 0), { len: len + 1, h: 1.4, seed: o.seed });
    },
  },
  picnicTable: {
    build(P, o) {
      const w = o.color || "woodL";
      P.add(P.box(8, 0.35, 3.6, w), 0, 3.0, 0);
      for (const sz of [-2.8, 2.8]) P.add(P.box(8, 0.3, 1.2, w), 0, 1.8, sz);
      for (const sx of [-3, 3]) for (const s of [-1, 1]) P.add(P.box(0.35, 3.6, 0.35, "wood"), sx, 1.5, s * 1.5, 0, s * 0.45);
    },
  },
  lampPost: { // street lamp; light: false keeps only the glowing lantern
    build(P, o) {
      const h = o.h || 10, iron = o.color || "dark";
      P.add(P.cyl(0.6, 0.75, 0.6, iron, 10), 0, 0.3, 0); P.add(P.cyl(0.17, 0.22, h, iron, 8), 0, h / 2, 0);
      P.add(P.cyl(0.85, 0.5, 0.5, iron, 8), 0, h + 1.9, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 1.4, 8), P.glow(o.lampColor || "lamp", 0.2, 3.2))), 0, h + 1.0, 0);
      P.add(P.cyl(0.4, 0.4, 0.15, iron, 8), 0, h + 0.25, 0);
      if (o.light !== false) P.light(o.lampColor || "lamp", [0, h - 0.2, 0], 0, 30, 26);
    },
  },
  path: { // flat walkway on the ground: w (across x), len (along z)
    build(P, o) {
      const w = o.w || 6, len = o.len || 30;
      P.add(P.box(w, 0.1, len, o.color || "path", false), 0, 0.05, 0);
      for (const sx of [-1, 1]) P.add(P.box(0.35, 0.18, len, o.color2 || ["stone", "#bdb5a6"], false), sx * (w / 2 + 0.15), 0.09, 0);
    },
  },
  fountain: {
    build(P, o) {
      const r = o.r || 5;
      P.add(P.cyl(r, r + 0.3, 1.6, o.color || ["stone", "#c9c2b4"], 32), 0, 0.8, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.CylinderGeometry(r - 0.5, r - 0.5, 0.1, 32), new THREE.MeshStandardMaterial({ color: "#5fa8c8", roughness: 0.12, metalness: 0.2 }))), 0, 1.45, 0);
      P.add(P.cyl(0.7, 0.9, 3.5, o.color || ["stone", "#c9c2b4"], 12), 0, 2.4, 0);
      P.add(P.cyl(2.0, 1.2, 0.5, o.color || ["stone", "#c9c2b4"], 20), 0, 4.2, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshStandardMaterial({ color: "#bfe6f5", roughness: 0.1, transparent: false }))), 0, 4.9, 0);
    },
  },
  fence: { // picket fence along x: len
    build(P, o) {
      const len = o.len || 12, c = o.color || "trim";
      for (let x = -len / 2; x <= len / 2 + 0.01; x += 0.9) P.add(P.box(0.5, 2.6, 0.18, c), x, 1.3, 0);
      for (const y of [0.8, 2.0]) P.add(P.box(len + 0.5, 0.3, 0.18, c), 0, y, -0.18);
    },
  },
  trashCan: { build(P, o) { P.add(P.cyl(0.85, 0.75, 2.6, o.color || "metal", 14), 0, 1.3, 0); P.add(P.cyl(0.95, 0.95, 0.2, "dark", 14), 0, 2.65, 0); } },
  // ---------------- school
  desk: { // student desk with a front panel; the seat behind it faces +Z (legs hidden by the panel)
    seats: [[0, 2.08, -1.7, 0]],
    build(P, o) {
      const top = o.color || "woodL", frame = o.color2 || "metal";
      P.add(P.box(4.2, 0.22, 2.6, top), 0, 2.75, 0);
      P.add(P.box(4.0, 1.5, 0.15, frame), 0, 1.95, 1.2);
      for (const sx of [-1, 1]) P.add(P.box(0.18, 2.65, 2.4, frame), sx * 1.95, 1.33, 0);
      if (o.chair !== false) PROPS.bistroChair.build(sub(P, 0, -1.7, 0), { color: o.chairColor || "fabric" });
      if (o.book !== false) { P.add(P.box(1.4, 0.18, 1.0, "accent2"), -0.6, 2.95, -0.1, 0.2); P.add(P.box(0.12, 0.12, 1.1, "accent"), 0.9, 2.92, 0, 0.6); }
    },
  },
  teacherDesk: {
    seats: [[0, 2.08, -2.4, 0]],
    build(P, o) {
      const w = o.color || "wood";
      P.add(P.box(8, 0.3, 3.4, w), 0, 2.85, 0); P.add(P.box(7.8, 2.0, 0.25, w), 0, 1.7, 1.5);
      for (const sx of [-1, 1]) P.add(P.box(0.3, 2.7, 3.2, w), sx * 3.85, 1.35, 0);
      P.add(P.box(1.2, 0.9, 0.9, "#d8463f"), -2.6, 3.45, -0.6); P.add(P.box(1.8, 0.22, 1.3, "accent"), 2.0, 3.1, 0.2, -0.2);
      P.add(P.cyl(0.3, 0.26, 0.9, "#f6efe2"), 3.1, 3.45, -0.8);
      if (o.chair !== false) PROPS.bistroChair.build(sub(P, 0, -2.4, 0), { color: "fabric" });
    },
  },
  chalkboard: { // wall board facing +Z: w, h, text (\n for lines)
    build(P, o) {
      const w = o.w || 16, h = o.h || 6;
      P.add(P.box(w + 0.8, h + 0.8, 0.3, o.color2 || "woodL"), 0, 0, 0);
      P.add(P.pic(w, h, (g, cw, ch) => {
        g.fillStyle = P.colorOf(o.color || "board"); g.fillRect(0, 0, cw, ch);
        g.globalAlpha = 0.08; g.fillStyle = "#ffffff"; for (let i = 0; i < 6; i++) g.fillRect(i * cw / 6, ch * 0.1, cw / 9, ch * 0.7); g.globalAlpha = 1;
        if (o.text) drawText(g, cw, ch, o.text, "#f4f1e4", 0.36);
      }), 0, 0, 0.17);
      P.add(P.box(w, 0.25, 0.7, o.color2 || "woodL"), 0, -h / 2 - 0.3, 0.4);
    },
  },
  lockers: { // row of lockers facing +Z: n
    build(P, o) {
      const n = o.n || 5, c = o.color || "accent";
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 2.2;
        P.add(P.box(2.1, 8, 2.2, c), x, 4, 0);
        for (const y of [6.6, 6.2]) P.add(P.box(1.2, 0.12, 0.05, "dark"), x, y, 1.12);
        P.add(P.box(0.18, 0.8, 0.2, "metal"), x + 0.7, 4.2, 1.15);
      }
      P.add(P.box(n * 2.2 + 0.2, 0.3, 2.4, "dark"), 0, 8.1, 0);
    },
  },
  clock: { build(P, o) { P.add(P.cyl(1.1, 1.1, 0.2, "#f4f1ea", 28), 0, 0, 0, 0, PI / 2); P.add(P.box(0.12, 0.8, 0.06, "dark"), 0, 0.3, 0.14); P.add(P.box(0.6, 0.1, 0.06, "dark"), 0.25, 0, 0.14); } },
  poster: { // paper poster facing +Z: w, h, text, color
    build(P, o) {
      const w = o.w || 3, h = o.h || 4, bg = P.colorOf(o.color || "accent"), fg = P.colorOf(o.color2 || "#ffffff");
      P.add(P.pic(w, h, (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = "rgba(255,255,255,0.25)"; g.beginPath(); g.arc(cw / 2, ch * 0.62, cw * 0.28, 0, 7); g.fill(); drawText(g, cw, ch * 0.4, o.text || "", fg, 0.45); }), 0, 0, 0.02);
    },
  },
  // ---------------- mall
  storefront: { // shop front against a back wall, facing +Z: w, h, text (name), color (accent), awning
    build(P, o) {
      const w = o.w || 14, h = o.h || 11, c = o.color || "accent", r = mulberry32((o.seed || 1) * 41);
      P.add(P.box(w, h, 1, o.color2 || "wall2"), 0, h / 2, -0.5);
      for (const sx of [-1, 1]) P.add(P.box(0.8, h, 1.2, "trim"), sx * (w / 2 - 0.4), h / 2, 0);
      P.add(P.box(w, 2.2, 1.4, c), 0, h - 1.4, 0.1);
      const name = o.text || "SHOP", ink = P.colorOf(o.textColor || "#ffffff");
      P.add(P.pic(w - 1.2, 1.7, (g, cw, ch) => { g.fillStyle = P.colorOf(c); g.fillRect(0, 0, cw, ch); g.shadowColor = ink; g.shadowBlur = 10; drawText(g, cw, ch, name, ink, 0.7); }), 0, h - 1.4, 0.82);
      // lit display window with shelves of goods and a glass door
      const dw = w - 6.6;
      P.add(P.noShadow(new THREE.Mesh(new THREE.BoxGeometry(dw, h - 4.6, 0.1), P.glow(o.inside || "#fff1d8", 0.55, 0.7))), -1.8, (h - 4.6) / 2 + 1.2, -0.05);
      const goods = ["#e76f51", "#2a9d8f", "#e9c46a", "#264653", "#f4a6c0", "#8a5a9a"];
      for (const y of [2.6, 4.9]) { P.add(P.box(dw - 0.4, 0.2, 1.0, "woodL"), -1.8, y, 0.4); for (let x = -dw / 2 + 0.6; x < dw / 2 - 0.4; x += 0.9 + r() * 0.5) P.add(P.box(0.6, 0.6 + r() * 0.9, 0.6, goods[Math.floor(r() * 6)]), -1.8 + x, y + 0.5, 0.4); }
      P.add(P.box(dw, 0.35, 0.4, "trim"), -1.8, 1.2, 0.4);
      P.add(P.box(3.2, 7.4, 0.15, P.glow("#ffe8c4", 0.35, 0.6)), w / 2 - 2.6, 3.7, 0.0);
      P.add(P.box(3.6, 0.4, 0.4, "trim"), w / 2 - 2.6, 7.6, 0.3); P.add(P.box(0.15, 1.4, 0.3, "metal"), w / 2 - 3.6, 3.8, 0.25);
      if (o.awning) for (let i = 0; i < Math.round(w / 1.4); i++) P.add(P.box(1.4, 0.2, 2.6, i % 2 ? "#ffffff" : c), -w / 2 + 0.7 + i * 1.4, h - 3.0, 1.6, 0, 0.35);
    },
  },
  escalator: { // escalator rising toward +x: run, rise, w
    build(P, o) {
      const run = o.run || 16, rise = o.rise || 8, w = o.w || 3.6, ang = Math.atan2(rise, run), len = Math.hypot(run, rise);
      const side = o.color || "metal", steps = Math.round(run / 0.9);
      for (let i = 0; i < steps; i++) P.add(P.box(0.9, 0.35, w - 0.6, "dark"), -run / 2 + (i + 0.5) * run / steps, 0.4 + (i * rise) / steps, 0);
      for (const sz of [-1, 1]) {
        P.add(P.box(len + 2, 1.8, 0.4, side), 0, rise / 2 + 0.3, sz * w / 2, 0, 0, ang);
        P.add(P.noShadow(new THREE.Mesh(new THREE.BoxGeometry(len + 2, 2.2, 0.12), new THREE.MeshStandardMaterial({ color: "#d8eef4", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }))), 0, rise / 2 + 2.3, sz * w / 2, 0, 0, ang);
        P.add(P.box(len + 2.6, 0.3, 0.45, "dark"), 0, rise / 2 + 3.5, sz * w / 2, 0, 0, ang);
      }
      P.add(P.box(5, rise, w + 1, o.color2 || "wall2"), run / 2 + 2.5, rise / 2, 0);
      P.add(P.box(5, 0.4, w + 1, "trim"), run / 2 + 2.5, rise + 0.2, 0);
    },
  },
  planter: { // long planter box full of leaves: len — cover in front of a bench
    build(P, o) {
      const len = o.len || 8, r = mulberry32((o.seed || 1) * 29), cols = leafCols(P.colorOf(o.color2 || "leaf"));
      const h = o.h || 2;
      P.add(P.box(len, h, 2.0, o.color || ["stone", "#d6d0c4"]), 0, h / 2, 0);
      for (let x = -len / 2 + 0.7; x <= len / 2 - 0.6; x += 1.1) P.add(P.ball(0.65 + r() * 0.3, ["leaves", cols[Math.floor(r() * 3)]], 1.1, 0.7, 1.1), x, h + 0.2 + r() * 0.2, (r() - 0.5) * 0.8);
    },
  },
  column: { build(P, o) { const h = o.h || P.H; P.add(P.box(o.w || 2, h, o.w || 2, o.color || "trim"), 0, h / 2, 0); P.add(P.box((o.w || 2) + 0.6, 0.6, (o.w || 2) + 0.6, "trim"), 0, 0.3, 0); } },
  kiosk: { // small booth with a counter and a sign: text
    build(P, o) {
      const c = o.color || "accent2";
      P.add(P.box(6, 2.7, 3, c), 0, 1.35, 0); P.add(P.box(6.4, 0.3, 3.4, "trim"), 0, 2.85, 0);
      for (const sx of [-1, 1]) P.add(P.cyl(0.12, 0.12, 4.2, "metal", 8), sx * 2.9, 5.5, 1.3);
      P.add(P.box(6.6, 0.4, 3.8, c), 0, 7.7, 0.2);
      P.add(P.pic(5.6, 1.2, (g, cw, ch) => { g.fillStyle = P.colorOf(c); g.fillRect(0, 0, cw, ch); drawText(g, cw, ch, o.text || "SNACKS", "#ffffff", 0.7); }), 0, 7.1, 2.1);
      for (let i = 0; i < 5; i++) P.add(P.ball(0.3, ["#f4a6c0", "#ffe08a", "#c79566", "#a4d4c5", "#e76f51"][i]), -2 + i, 3.3, 1.0);
    },
  },
  balcony: { // upper walkway slab along x at height y with a glass rail: len, y, d
    build(P, o) {
      const len = o.len || 40, y = o.h || 9, d = o.d || 6;
      P.add(P.box(len, 0.8, d, o.color || "trim"), 0, y, 0);
      P.add(P.noShadow(new THREE.Mesh(new THREE.BoxGeometry(len, 2.4, 0.12), new THREE.MeshStandardMaterial({ color: "#d8eef4", roughness: 0.05, transparent: true, opacity: 0.3 }))), 0, y + 1.6, d / 2);
      P.add(P.box(len, 0.25, 0.4, "metal"), 0, y + 2.85, d / 2);
    },
  },
  ceilingLight: { // flat glowing panel just under the ceiling: w, d
    build(P, o) { P.add(P.noShadow(new THREE.Mesh(new THREE.BoxGeometry(o.w || 6, 0.2, o.d || 2), P.glow(o.color || "#fff8ec", 0.9, 1.1))), 0, P.H - 0.15, 0); },
  },
};
/** a nested prop group inside a prop (shares the parent's helpers) */
function sub(P, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; P.g.add(g);
  return { ...P, g, add: (mesh, px = 0, py = 0, pz = 0, pry = 0, prx = 0, prz = 0) => { mesh.position.set(px, py, pz); mesh.rotation.set(prx, pry, prz); g.add(mesh); return mesh; } };
}
export const PROP_NAMES = Object.keys(PROPS);
