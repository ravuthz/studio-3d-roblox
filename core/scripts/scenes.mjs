// Lists kit scenes (core/scenes/<id>.json) for prompts and tools. The browser builds them (core/engine/kit.js).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE } from "./lib.mjs";

export const SCENES_DIR = join(CORE, "scenes");

/** [{ id, label, series, about, cams, seats, marks }] sorted by id */
export function listScenes() {
  if (!existsSync(SCENES_DIR)) return [];
  return readdirSync(SCENES_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const L = JSON.parse(readFileSync(join(SCENES_DIR, f), "utf8"));
    const seats = [...(L.props || []).flatMap((p) => p.seats || []), ...Object.keys(L.seats || {})].filter(Boolean);
    return { id: L.id || f.slice(0, -5), label: L.label || L.id, series: L.series || [], about: L.about || "",
      cams: Object.keys(L.cams || {}), seats, marks: Object.keys(L.marks || {}) };
  });
}

/** one line per scene for an agent prompt */
export function scenesText(seriesId = null) {
  return listScenes().filter((s) => !seriesId || !s.series.length || s.series.includes(seriesId))
    .map((s) => `"${s.id}" (${s.label}): ${s.about} cams: ${s.cams.join(", ")}; seats: ${s.seats.join(", ") || "none"}; marks: ${s.marks.join(", ")}`).join("\n");
}
