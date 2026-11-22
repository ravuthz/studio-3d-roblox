import {
  AudioLines,
  Camera,
  CheckCheck,
  Clapperboard,
  Hammer,
  ListOrdered,
  Mic,
  Music,
  Play,
  RotateCcw,
  ScrollText,
  Terminal,
  Workflow,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { JobConsole } from "@/components/job-console"
import { JobBadge, LangBadge, LengthBadge, MoodBadge, StateBadge, StyleBadge } from "@/components/status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  api,
  fmtAgo,
  fmtBytes,
  fmtTime,
  media,
  pipeline,
  renderUrl,
  type FilmDetail,
  type Job,
  type StageState,
  type Step,
  type StoryLine,
  type Style,
} from "@/lib/api"
import { go } from "@/lib/route"
import { usePoll } from "@/lib/use-poll"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------- pipeline

interface StepDef {
  step: Step
  title: string
  detail: string
  icon: typeof Mic
  state?: StageState
  updated?: number | null
  confirm?: string
}

function ConfirmRun({ message, onConfirm, disabled, variant, children }: { message?: string; onConfirm: () => void; disabled: boolean; variant?: "outline"; children: ReactNode }) {
  const button = (
    <Button variant={variant} size={variant ? "sm" : "default"} disabled={disabled} onClick={message ? undefined : onConfirm}>
      {children}
    </Button>
  )
  if (!message) return button
  return (
    <Dialog>
      <DialogTrigger asChild>{button}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Run this step?</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm}>Run</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Pipeline({ film, busy, run }: { film: FilmDetail; busy: boolean; run: (s: Step, args?: string[]) => void }) {
  const p = pipeline(film)
  const legacy = !film.lang
  const steps: StepDef[] = [
    legacy
      ? {
          step: "voice",
          title: "Voice (legacy)",
          detail: "ElevenLabs narration and word timings. This film has no \"lang\" in story.json.",
          icon: Mic,
          state: p.narrate,
          updated: film.files.timing,
          confirm: "This film uses the legacy ElevenLabs voice and spends credits when the text changed.",
        }
      : {
          step: "narrate",
          title: "Narrate",
          detail: `Voice clone from voices/${film.lang === "km" ? "ravuthz" : "in-town"}.mp3, cached per line, then word timings.`,
          icon: Mic,
          state: p.narrate,
          updated: film.files.timing,
        },
    { step: "plan", title: "Plan", detail: "Cut times, sound events and durations from the timings.", icon: ListOrdered, state: p.plan, updated: film.files.plan },
    { step: "audio", title: "Audio", detail: "Synthesised music bed and sound effects.", icon: Music, state: p.audio, updated: film.files.music },
    { step: "check", title: "Check", detail: "HyperFrames lint of the page.", icon: CheckCheck },
    { step: "shots", title: "Shots", detail: "Snapshot the middle frame of every shot for review.", icon: Camera, state: p.shots, updated: film.files.shots },
    { step: "render", title: "Render", detail: `renders/${film.name}.mp4 · ${fmtBytes(film.renderSize)}`, icon: Clapperboard, state: p.render, updated: film.files.render },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="size-4" /> Pipeline
        </CardTitle>
        <CardDescription>A stage is out of date when a file it is built from changed after it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {steps.map((s, i) => (
          <div
            key={s.step}
            className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
              <s.icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {s.title}
                {s.state && <StateBadge state={s.state} />}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {s.detail}
                {s.updated ? ` · ${fmtAgo(s.updated)}` : ""}
              </p>
            </div>
            <ConfirmRun message={s.confirm} onConfirm={() => run(s.step)} disabled={busy} variant="outline">
              <Play /> Run
            </ConfirmRun>
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-3">
          <div className="text-sm">
            <div className="font-medium">Build everything</div>
            <p className="text-xs text-muted-foreground">
              {legacy ? "voice" : "narrate"} → plan → audio → check → render
            </p>
          </div>
          <ConfirmRun
            message={`Runs the whole pipeline${legacy ? ", including the legacy ElevenLabs voice step" : ""}. A render takes several minutes.`}
            onConfirm={() => run("build")}
            disabled={busy}
          >
            <Hammer /> Build
          </ConfirmRun>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- script

function LineText({ line }: { line: StoryLine }) {
  const big = new Set((line.big ?? []).map((w) => w.toLowerCase()))
  const cuts = [...(line.cuts ?? [])].map((w) => w.toLowerCase())
  return (
    <>
      {line.text.split(/(\s+)/).map((tok, i) => {
        const bare = tok.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")
        // like plan.mjs: cut words are searched in order, starting after the first word
        const isCut = i > 0 && cuts.length > 0 && bare.replace(/[^a-z]/g, "") === cuts[0].replace(/[^a-z]/g, "")
        if (isCut) cuts.shift()
        return (
          <span key={i} className={cn(big.has(bare) && "font-semibold text-brand")}>
            {isCut && <span className="mr-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-muted-foreground/60" title="cut" />}
            {tok}
          </span>
        )
      })}
    </>
  )
}

function Script({ film, seek }: { film: FilmDetail; seek: (t: number) => void }) {
  const cuts = film.plan?.cuts ?? {}
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20 pl-4">Time</TableHead>
            <TableHead className="w-28">Cut</TableHead>
            <TableHead>Line</TableHead>
            <TableHead className="w-24 pr-4 text-right">Mood</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {film.story.lines.map((l) => {
            const t = cuts[l.id]
            return (
              <TableRow key={l.id}>
                <TableCell className="pl-4 align-top">
                  {t != null ? (
                    <button
                      onClick={() => seek(t)}
                      className="font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground hover:underline"
                    >
                      {fmtTime(t)}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <span className="font-mono text-xs">{l.id}</span>
                  {l.cuts?.length ? (
                    <span className="ml-1 text-xs text-muted-foreground">+{l.cuts.length}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm whitespace-normal">
                  <LineText line={l} />
                </TableCell>
                <TableCell className="pr-4 text-right align-top">{l.mood && <MoodBadge mood={l.mood} />}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

// ---------------------------------------------------------------- shots

function Shots({ film, seek, busy, run }: { film: FilmDetail; seek: (t: number) => void; busy: boolean; run: (s: Step, a?: string[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const order = film.plan?.order ?? []
  const cuts = film.plan?.cuts ?? {}
  const cutAt = (t: number) => {
    let id = order[0]
    for (const o of order) if (cuts[o] <= t) id = o
    return id
  }
  const frames = film.snapshots?.frames ?? []
  if (!frames.length)
    return (
      <Alert>
        <Camera />
        <AlertTitle>No snapshots yet</AlertTitle>
        <AlertDescription>Run the Shots step to capture the middle frame of every shot.</AlertDescription>
      </Alert>
    )
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {frames.length} frames · updated {fmtAgo(film.snapshots?.updatedAt ?? null)} · click a frame to pick it
        </p>
        <div className="flex gap-2">
          {picked.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || picked.size === 0}
            onClick={() => {
              run("shots", order.filter((o) => picked.has(o)))
              setPicked(new Set())
            }}
          >
            <RotateCcw /> Re-shoot {picked.size || ""}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
        {frames.map((f) => {
          const id = cutAt(f.t)
          const on = picked.has(id)
          return (
            <figure key={f.path} className="group grid gap-1.5">
              <button
                onClick={() => toggle(id)}
                className={cn(
                  "relative aspect-[9/16] overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  on && "ring-2 ring-brand ring-offset-2 ring-offset-background",
                )}
              >
                <img src={media(film.name, f.path)} alt={id} loading="lazy" className="size-full object-cover" />
              </button>
              <figcaption className="flex items-center justify-between gap-1 text-xs">
                <span className="truncate font-mono">{id}</span>
                <button onClick={() => seek(f.t)} className="font-mono text-muted-foreground tabular-nums hover:text-foreground">
                  {fmtTime(f.t)}
                </button>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- runs

function Runs({ film, jobs, selected, select, reload }: { film: FilmDetail; jobs: Job[]; selected: string | null; select: (id: string) => void; reload: () => void }) {
  const job = jobs.find((j) => j.id === selected) ?? jobs[0]
  if (!jobs.length)
    return (
      <Alert>
        <Terminal />
        <AlertTitle>No runs yet</AlertTitle>
        <AlertDescription>Run a pipeline step for {film.name}; its log streams here.</AlertDescription>
      </Alert>
    )
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
      <Card className="gap-1 self-start py-2">
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => select(j.id)}
            className={cn(
              "mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
              j.id === job?.id && "bg-muted",
            )}
          >
            <span>
              <span className="font-medium">{j.step === "write" ? `${j.agent} writes` : j.step}</span>
              {j.model && <span className="block truncate font-mono text-xs text-muted-foreground">{j.model}</span>}
              {j.args.length > 0 && <span className="text-muted-foreground"> {j.args.length} ids</span>}
              <span className="block text-xs text-muted-foreground">{fmtAgo(j.startedAt)}</span>
            </span>
            <JobBadge status={j.status} />
          </button>
        ))}
      </Card>
      {job && <JobConsole key={job.id} job={job} onEnd={reload} />}
    </div>
  )
}

// ---------------------------------------------------------------- page

export function FilmPage({ name, tab, onChanged }: { name: string; tab: string; onChanged: () => void }) {
  const film = usePoll(() => api.film(name), 5000, [name])
  const jobs = usePoll(() => api.jobs(name), 3000, [name])
  const [selected, setSelected] = useState<string | null>(null)
  const [styles, setStyles] = useState<Style[]>([])
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    api.styles().then(setStyles).catch(() => setStyles([]))
  }, [])
  const f = film.data
  const busy = !!jobs.data?.some((j) => j.status === "running")
  const src = useMemo(() => (f ? renderUrl(f) : null), [f])

  const seek = (t: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = t
    v.play().catch(() => {})
  }
  const run = async (step: Step, args: string[] = []) => {
    try {
      const job = await api.run(name, step, args)
      toast.success(`Started ${step}`, { description: args.length ? args.join(", ") : name })
      setSelected(job.id)
      await jobs.reload()
      onChanged()
      go(`#/film/${name}/runs`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  /** the style is one line in story.json; the server re-plans so shots and the render show as stale */
  const changeStyle = async (style: string) => {
    try {
      const { job } = await api.setStyle(name, style)
      const label = styles.find((x) => x.id === style)?.label ?? style
      toast.success(`Style set to ${label}`, { description: job ? "Re-planning. Take shots or render again to see it." : "Saved in story.json." })
      if (job) setSelected(job.id)
      await Promise.all([film.reload(), jobs.reload()])
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const finished = () => {
    film.reload()
    jobs.reload()
    onChanged()
  }

  if (film.error)
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load {name}</AlertTitle>
          <AlertDescription>{film.error}</AlertDescription>
        </Alert>
      </div>
    )
  if (!f)
    return (
      <div className="grid grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-[300px_1fr]">
        <Skeleton className="aspect-[9/16] rounded-xl" />
        <div className="grid content-start gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )

  const wps = f.voEnd ? f.words / f.voEnd : null
  const stats = [
    { label: "Narration", value: fmtTime(f.voEnd) },
    { label: "Shots", value: String(f.shots) },
    { label: "Avg shot", value: f.avgShot ? `${f.avgShot.toFixed(2)} s` : "—" },
    { label: "Words", value: `${f.words}${wps ? ` · ${wps.toFixed(1)}/s` : ""}` },
  ]

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="mx-auto grid w-full max-w-[300px] content-start gap-3 lg:sticky lg:top-20 lg:self-start">
        <div className="relative aspect-[9/16] overflow-hidden rounded-xl border bg-black shadow-sm">
          {src ? (
            <video
              ref={video}
              key={src}
              src={src}
              poster={f.thumb ? media(f.name, f.thumb) : undefined}
              controls
              playsInline
              preload="metadata"
              className="size-full"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-zinc-400">
              <Clapperboard className="size-8" /> Not rendered yet
            </div>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          1080×1920 · 30 fps{f.files.render ? ` · rendered ${fmtAgo(f.files.render)}` : ""}
        </p>
      </aside>

      <div className="grid min-w-0 content-start gap-6">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              outputs/{f.name}
            </Badge>
            <LangBadge lang={f.lang} />
            {styles.length > 0 ? (
              <Select value={f.style} onValueChange={changeStyle} disabled={busy}>
                <SelectTrigger size="sm" aria-label="Film style" className="h-6! gap-1 px-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {styles.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <StyleBadge style={f.style} />
            )}
            <LengthBadge voEnd={f.voEnd} />
            {busy && <JobBadge status="running" />}
          </div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">{f.title}</h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border bg-card px-3 py-2">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="font-semibold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(t) => go(`#/film/${name}/${t}`)}>
          <TabsList>
            <TabsTrigger value="overview">
              <Workflow /> Pipeline
            </TabsTrigger>
            <TabsTrigger value="script">
              <ScrollText /> Script
            </TabsTrigger>
            <TabsTrigger value="shots">
              <Camera /> Shots
            </TabsTrigger>
            <TabsTrigger value="runs">
              <AudioLines /> Runs
              {busy && <span className="size-1.5 rounded-full bg-brand" />}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <Pipeline film={f} busy={busy} run={run} />
          </TabsContent>
          <TabsContent value="script" className="mt-4">
            <Script film={f} seek={seek} />
          </TabsContent>
          <TabsContent value="shots" className="mt-4">
            <Shots film={f} seek={seek} busy={busy} run={run} />
          </TabsContent>
          <TabsContent value="runs" className="mt-4">
            <Runs film={f} jobs={jobs.data ?? []} selected={selected} select={setSelected} reload={finished} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
