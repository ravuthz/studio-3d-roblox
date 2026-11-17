import { Square, Terminal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { JobBadge } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type Job } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Live log of one job, streamed over server-sent events. */
export function JobConsole({ job: initial, onEnd, className }: { job: Job; onEnd?: (j: Job) => void; className?: string }) {
  const [job, setJob] = useState(initial)
  const [lines, setLines] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const onEndRef = useRef(onEnd)
  const [now, setNow] = useState(initial.startedAt)
  useEffect(() => {
    onEndRef.current = onEnd
  })
  useEffect(() => {
    if (job.status !== "running") return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job.status])

  // the parent keys this component by job id, so one console follows one job
  useEffect(() => {
    const es = new EventSource(`/api/jobs/${initial.id}/stream`)
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data)
      if (ev.type === "init") {
        setJob(ev.job)
        setLines(ev.lines)
      } else if (ev.type === "line") setLines((l) => [...l.slice(-4999), ev.line])
      else if (ev.type === "end") {
        setJob(ev.job)
        es.close()
        onEndRef.current?.(ev.job)
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [initial.id])

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])

  const elapsed = Math.max(0, ((job.endedAt ?? now) - job.startedAt) / 1000)

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Terminal className="size-4" />
          film {job.step} {job.film} {job.args.join(" ")}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          <JobBadge status={job.status} />
          <span className="tabular-nums">{elapsed.toFixed(0)} s</span>
          {job.code != null && job.code !== 0 && <span>exit {job.code}</span>}
        </CardDescription>
        {job.status === "running" && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => api.stop(job.id).catch((e) => toast.error(e.message))}
            >
              <Square /> Stop
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="h-80 overflow-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200 dark:bg-black/60"
        >
          {lines.length === 0 && <span className="text-zinc-500">Waiting for output…</span>}
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                "break-all whitespace-pre-wrap",
                /✗|\bfailed\b|^\s*error\b|Error:|\b[1-9]\d* errors?\b/i.test(l) && "text-rose-400",
                /✓|\bdone\b|\bwritten\b|\b0 errors\b/i.test(l) && "text-emerald-400",
              )}
            >
              {l || " "}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
