// The film styles. Each is a folder here with its builder (build.py), its assets and a style.js
// the engine reads. core/styles/styles.json lists the same ids for the CLI and the Film Studio.
import roblox from "./roblox/style.js";
import pixarDisney from "./pixar-disney/style.js";

export const STYLES = { roblox, "pixar-disney": pixarDisney };
export const DEFAULT_STYLE = "roblox";
const ALIASES = { blocky: "roblox", toy: "pixar-disney" }; // names used before the styles had folders

/** the style object for a name from story.json; no name means the default */
export function resolveStyle(name) {
  const id = ALIASES[name] || name || DEFAULT_STYLE;
  if (!STYLES[id]) console.warn(`unknown style "${name}", using ${DEFAULT_STYLE}`);
  return STYLES[id] || STYLES[DEFAULT_STYLE];
}
