// Shared series loader used by core/scripts/film.mjs and studio/server/*.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE } from "./lib.mjs";

export const SERIES_DIR = join(CORE, "series");
const SERIES_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** all series JSON definitions under core/series/, sorted by id */
export function listSeries() {
  if (!existsSync(SERIES_DIR)) return [];
  return readdirSync(SERIES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SERIES_DIR, f), "utf8")));
}

/** one series by id, or null if not found */
export function getSeries(id) {
  if (!id || !SERIES_ID.test(id)) return null;
  const p = join(SERIES_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** default series ("family" if present, else the first one) */
export function defaultSeries() {
  return getSeries("family") || listSeries()[0] || null;
}

/** resolves an optional series id, throwing a clear error if an unknown id was given */
export function resolveSeries(id) {
  if (!id) {
    const s = defaultSeries();
    if (!s) throw new Error(`No series found in ${SERIES_DIR}`);
    return s;
  }
  const s = getSeries(id);
  if (!s) {
    const known = listSeries().map((x) => x.id).join(", ");
    throw new Error(`Unknown series "${id}" (available: ${known || "none"})`);
  }
  return s;
}
