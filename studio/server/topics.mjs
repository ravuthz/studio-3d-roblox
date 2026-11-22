// Series-driven topic selection and topic-generation prompts.
// Series definitions live in core/series/<id>.json (loaded via core/scripts/series.mjs).
import { getSeries, listSeries, resolveSeries } from "../../core/scripts/series.mjs";
import { listScenes } from "../../core/scripts/scenes.mjs";

export { getSeries, listSeries, resolveSeries };

/** the series' story format: { label, shape } */
export const formatOf = (s) => s.format || { label: "skit", shape: "" };

/** a folder name from free text: "Nobody can catch Biscuit!" -> "nobody-can-catch-biscuit" */
export function slugify(text, words = 8) {
  return String(text || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, words)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");
}

/** ensures a valid lowercase folder slug that is not in `taken` */
export function freeSlug(raw, taken) {
  const cleaned = slugify(raw, 5) || "new-topic";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? cleaned : `${cleaned.slice(0, 58)}-${i}`;
    if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(candidate) && !taken.has(candidate)) return candidate;
  }
}

/** picks a fresh built-in English topic for the chosen series, avoiding existing names/titles */
export function pickTopic({ series = null, takenNames = new Set(), takenTitles = new Set() } = {}) {
  const s = resolveSeries(series);
  const topics = s.topics || [];
  if (!topics.length) throw new Error(`Series "${s.id}" has no built-in topics`);
  const norm = (str) => String(str || "").trim().toLowerCase();
  const fresh = topics.filter((t) => !takenNames.has(t.name) && !takenTitles.has(norm(t.title)));
  const pool = fresh.length > 0 ? fresh : topics;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { name: freeSlug(pick.name, takenNames), title: pick.title, idea: pick.idea, series: s.id };
}

/** read-only prompt asking an AI CLI for one original JSON topic for the chosen series */
export function topicPrompt({ series = null, takenNames = [], takenTitles = [] } = {}) {
  const s = resolveSeries(series);
  const fmt = formatOf(s);
  const avoidList = [...takenTitles.slice(0, 30), ...takenNames.slice(0, 30)].filter(Boolean);
  const castLine = (s.cast || []).map((c) => `${c.name} (${c.role})`).join(", ");
  return `Invent ONE original story topic in English for a 62–75 second vertical 3D blocky short film in the "${s.label}" series (${fmt.label}).

World & cast constraints:
- Series: ${s.label} (${s.id})
- Narrator (first person): ${s.narrator.name} (${s.narrator.role})
- Cast: ${castLine}. Townspeople can appear in the background. Do NOT use the old family (Zero, Zeebra, Luna, Zip).
- Available 3D places: cosy home interior (living room + kitchen, dog bed), cafe with window table and counter, pastel town street, house front, bedroom, forest clearing, highway with SUV cabin and stereo${listScenes().filter((x) => !x.series.length || x.series.includes(s.id)).map((x) => `, ${x.label.toLowerCase()}`).join("")}; props: cars, pancakes, books. Prefer these places; a new place is possible only when the story truly needs it.
- Story shape: ${fmt.shape}
- Grounded, relatable everyday situation; no magic rules, no "In this town" title. Must be 100% original.${avoidList.length ? `\n- Avoid these existing/recent topics: ${avoidList.join("; ")}` : ""}

Reply with ONLY a raw JSON object (no markdown fences, no commentary) with exactly these string keys:
{
  "name": "short-kebab-slug",
  "title": "short catchy title",
  "idea": "2-3 sentences covering the setup, escalation with the cast, and the payoff or twist."
}`;
}

/** extracts and validates { name, title, idea } from an AI CLI stdout response */
export function parseTopic(raw, takenNames = new Set()) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent did not return a JSON topic");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Could not parse JSON topic from agent output");
  }
  const title = String(parsed.title || "").trim().slice(0, 200);
  const idea = String(parsed.idea || "").trim().slice(0, 4000);
  if (!title || !idea) throw new Error("Agent returned an incomplete topic");
  const name = freeSlug(String(parsed.name || title), takenNames);
  return { name, title, idea };
}
