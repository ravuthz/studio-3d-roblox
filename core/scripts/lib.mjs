// Shared helpers for the film scripts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CORE = join(ROOT, "core");
export const OUTPUTS = join(ROOT, "outputs");

/** A film is named by its folder under outputs/ (or given as a path). */
export function filmDir(arg, { mustExist = true } = {}) {
  if (!arg) throw new Error("Give a film name, e.g. zark (a folder under outputs/)");
  const dir = isAbsolute(arg) ? arg : existsSync(join(ROOT, arg, "story")) ? join(ROOT, arg) : join(OUTPUTS, arg);
  if (mustExist && !existsSync(join(dir, "story", "story.json"))) throw new Error(`No film at ${dir} (story/story.json missing)`);
  return dir;
}
export const bare = (w) => w.toLowerCase().replace(/[^a-z]/g, "");

/** The film styles: core/styles/styles.json lists them; each has a folder core/styles/<id>/. */
export function styles() {
  const reg = JSON.parse(readFileSync(join(CORE, "styles/styles.json"), "utf8"));
  return reg.styles.map((s) => ({ ...s, default: s.id === reg.default }));
}
/** the style id for a name from story.json or the command line (aliases allowed; empty = the default) */
export function styleId(name) {
  const all = styles();
  if (!name) return all.find((s) => s.default).id;
  const hit = all.find((s) => s.id === name || (s.aliases || []).includes(name));
  if (!hit) throw new Error(`Unknown style "${name}". Styles: ${all.map((s) => s.id).join(", ")}`);
  return hit.id;
}
