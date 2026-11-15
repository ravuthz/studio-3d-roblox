// Shared helpers for the film scripts.
import { existsSync } from "node:fs";
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
