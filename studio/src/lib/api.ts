export type Mood = "day" | "warm" | "dark" | "tense"

export interface StoryLine {
  id: string
  text: string
  cuts?: string[]
  big?: string[]
  mood?: Mood
  hits?: number[]
  pops?: number[]
  flash?: number[]
}

export interface FilmFiles {
  story: number | null
  film: number | null
  vo: number | null
  timing: number | null
  plan: number | null
  music: number | null
  sfx: number | null
  render: number | null
  shots: number | null
}

export interface FilmSummary {
  name: string
  title: string
  lang: "en" | "km" | null
  lines: number
  words: number
  shots: number
  duration: number | null
  voEnd: number | null
  avgShot: number | null
  createdAt: string | null
  renderSize: number | null
  thumb: string | null
  files: FilmFiles
  running: boolean
}

export interface SnapshotFrame {
  t: number
  path: string
  run: string
  at: number
}

export interface FilmDetail extends FilmSummary {
  story: { title: string; names?: string[]; lang?: string; lines: StoryLine[] }
  plan: { order: string[]; cuts: Record<string, number>; duration: number; voEnd: number } | null
  snapshots: { runs: number; updatedAt: number | null; frames: SnapshotFrame[] } | null
}

export type Step = "narrate" | "voice" | "plan" | "audio" | "check" | "shots" | "render" | "build"

export interface AgentModel {
  id: string
  label: string
}

export interface Agent {
  name: string
  installed: boolean
  /** models the CLI lists (or STUDIO_MODELS_<AGENT>); empty means only the CLI default */
  models: AgentModel[]
}

export interface NewFilm {
  name: string
  title: string
  lang: "en" | "km"
  agent: string | null
  /** null = the agent CLI's own default model */
  model: string | null
  idea: string
}

export interface Job {
  id: string
  film: string
  /** pipeline step, or "write" when an AI agent writes the story */
  step: Step | "write"
  agent?: string
  model?: string | null
  args: string[]
  status: "running" | "done" | "failed" | "stopped"
  code: number | null
  startedAt: number
  endedAt: number | null
  lineCount: number
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data as T
}

export const api = {
  films: () => request<FilmSummary[]>("/api/films"),
  film: (name: string) => request<FilmDetail>(`/api/films/${name}`),
  agents: () => request<Agent[]>("/api/agents"),
  create: (film: NewFilm) =>
    request<{ film: FilmSummary; job: Job | null }>("/api/films", { method: "POST", body: JSON.stringify(film) }),
  run: (name: string, step: Step, args: string[] = []) =>
    request<Job>(`/api/films/${name}/run`, { method: "POST", body: JSON.stringify({ step, args }) }),
  jobs: (film?: string) => request<Job[]>(`/api/jobs${film ? `?film=${film}` : ""}`),
  stop: (id: string) => request<Job>(`/api/jobs/${id}/stop`, { method: "POST" }),
  openOutputs: () => request<{ opened: string }>("/api/open", { method: "POST" }),
}

export const media = (film: string, path: string) =>
  `/media/${film}/${path.split("/").map(encodeURIComponent).join("/")}`

export const renderUrl = (f: Pick<FilmSummary, "name" | "files">) =>
  f.files.render ? `${media(f.name, `renders/${f.name}.mp4`)}?v=${Math.round(f.files.render)}` : null

/** what a job runs, as a command line */
export const jobLabel = (j: Job) =>
  j.step === "write" ? `${j.agent}${j.model ? ` (${j.model})` : ""} · write story and shots for ${j.film}` : `film ${j.step} ${j.film} ${j.args.join(" ")}`.trim()

export function fmtTime(s: number | null | undefined) {
  if (s == null) return "—"
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`
}

export function fmtBytes(n: number | null) {
  if (n == null) return "—"
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`
}

export function fmtAgo(ms: number | null) {
  if (!ms) return "never"
  const s = (Date.now() - ms) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** The default film length is 2–3 minutes of narration. */
export const lengthStatus = (voEnd: number | null) =>
  voEnd == null ? "none" : voEnd < 120 ? "short" : voEnd > 180 ? "long" : "ok"

export type StageState = "missing" | "stale" | "fresh"

/** Each pipeline stage is stale when something it is built from changed after it. */
export function pipeline(f: FilmSummary) {
  const x = f.files
  const newer = (out: number | null, ...inputs: (number | null)[]): StageState =>
    !out ? "missing" : inputs.some((i) => i != null && i > out + 1000) ? "stale" : "fresh"
  return {
    narrate: newer(x.timing, x.story),
    plan: newer(x.plan, x.timing, x.story),
    audio: newer(x.music, x.plan),
    shots: newer(x.shots, x.plan, x.film),
    render: newer(x.render, x.plan, x.film, x.music, x.vo),
  }
}
