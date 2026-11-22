import { CircleCheck, CircleDashed, CircleAlert, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Job, Mood, StageState } from "@/lib/api"
import { cn } from "@/lib/utils"

const MOODS: Record<Mood, string> = {
  day: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warm: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  dark: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  tense: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
}

export function MoodBadge({ mood }: { mood: Mood }) {
  return <Badge className={cn("border-transparent", MOODS[mood])}>{mood}</Badge>
}

export function LangBadge({ lang }: { lang: string | null }) {
  return (
    <Badge variant="outline" className="font-mono uppercase">
      {lang ?? "en · 11labs"}
    </Badge>
  )
}

const STYLE_LABELS: Record<string, string> = { roblox: "Roblox", "pixar-disney": "Pixar-Disney" }

/** a film's style; pass the list from api.styles() for labels of styles added later */
export function StyleBadge({ style, label, className }: { style: string; label?: string; className?: string }) {
  return (
    <Badge variant="secondary" className={className}>
      {label ?? STYLE_LABELS[style] ?? style}
    </Badge>
  )
}

export function StateIcon({ state, className }: { state: StageState; className?: string }) {
  if (state === "fresh") return <CircleCheck className={cn("size-4 text-success", className)} />
  if (state === "stale") return <CircleAlert className={cn("size-4 text-warning", className)} />
  return <CircleDashed className={cn("size-4 text-muted-foreground", className)} />
}

export function StateBadge({ state }: { state: StageState }) {
  const label = { fresh: "Up to date", stale: "Out of date", missing: "Not built" }[state]
  return (
    <Badge
      variant="outline"
      className={cn(
        state === "fresh" && "border-success/40 text-success",
        state === "stale" && "border-warning/50 text-warning",
        state === "missing" && "text-muted-foreground",
      )}
    >
      <StateIcon state={state} className="size-3" />
      {label}
    </Badge>
  )
}

export function JobBadge({ status }: { status: Job["status"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "running" && "border-brand/50 text-brand",
        status === "done" && "border-success/40 text-success",
        (status === "failed" || status === "stopped") && "border-destructive/40 text-destructive",
      )}
    >
      {status === "running" && <Loader2 className="animate-spin" />}
      {status}
    </Badge>
  )
}

export function LengthBadge({ voEnd }: { voEnd: number | null }) {
  if (voEnd == null) return null
  const s = voEnd < 120 ? "short" : voEnd > 180 ? "long" : "ok"
  if (s === "ok") return null
  return (
    <Badge variant="outline" className="border-warning/50 text-warning" title="The default length is 2–3 minutes">
      {s === "short" ? "under 2 min" : "over 3 min"}
    </Badge>
  )
}
