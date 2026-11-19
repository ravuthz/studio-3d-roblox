import { CheckCircle2, Loader2, Rocket, Square, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api, type AutoState } from "@/lib/api"

const PHASE = { topic: "picking the next topic", write: "writing story and shots", build: "narrate → render" } as const

/** live autopilot progress in the sidebar footer; polls while it runs */
export function AutopilotStatus({ onChange }: { onChange: () => void }) {
  const [state, setState] = useState<AutoState | null>(null)
  const last = useRef<string>("")

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const s = await api.auto().catch(() => null)
      if (!alive) return
      setState(s)
      // refresh the film list whenever a film appears or changes step
      const key = s ? `${s.status}:${s.films.map((f) => `${f.name}/${f.step}/${f.status}`).join(",")}` : ""
      if (key !== last.current) {
        if (last.current && s?.status !== "running") toast.message(s?.log.at(-1) ?? "Autopilot finished")
        last.current = key
        onChange()
      }
      timer = setTimeout(tick, s?.status === "running" ? 3000 : 10000)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [onChange])

  if (!state) return null
  const done = state.films.filter((f) => f.status === "done").length
  const running = state.status === "running"
  const film = state.films.at(-1)

  return (
    <div className="mx-2 grid gap-1.5 rounded-md border bg-card p-2 text-xs group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-1.5 font-medium">
        {running ? <Loader2 className="size-3.5 animate-spin text-brand" /> : <Rocket className="size-3.5" />}
        <span className="flex-1">Autopilot {running ? "" : state.status}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {done}/{state.count || "∞"}
        </span>
        {running && (
          <Button size="icon" variant="ghost" className="size-6" title="Stop autopilot" onClick={() => api.stopAuto().then(setState)}>
            <Square className="size-3" />
          </Button>
        )}
      </div>
      {film && (
        <a href={`#/film/${film.name}/runs`} className="flex items-center gap-1.5 truncate text-muted-foreground hover:text-foreground">
          {film.status === "done" ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
          ) : film.status === "running" ? null : (
            <XCircle className="size-3.5 shrink-0 text-destructive" />
          )}
          <span className="truncate font-mono">{film.name}</span>
        </a>
      )}
      {running && state.phase && <span className="text-muted-foreground">{PHASE[state.phase]}</span>}
    </div>
  )
}
