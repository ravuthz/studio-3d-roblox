import { Clapperboard, Film, Plus, Scissors, Timer } from "lucide-react"

import { NewFilmDialog } from "@/components/new-film-dialog"
import { LengthBadge, StateIcon } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtAgo, fmtTime, media, pipeline, type FilmSummary } from "@/lib/api"

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Film; label: string; value: string; hint: string }) {
  return (
    <Card className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function FilmCard({ film }: { film: FilmSummary }) {
  const p = pipeline(film)
  const stages = Object.entries(p) as [keyof typeof p, (typeof p)[keyof typeof p]][]
  return (
    <a href={`#/film/${film.name}`} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow group-hover:shadow-md">
        <div className="relative aspect-[9/12] overflow-hidden bg-muted">
          {film.thumb ? (
            <img
              src={media(film.name, film.thumb)}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Clapperboard className="size-8" />
            </div>
          )}
          <Badge className="absolute top-2 left-2 border-transparent bg-black/70 font-mono text-white uppercase">
            {film.lang ?? "en · 11labs"}
          </Badge>
          <Badge className="absolute right-2 bottom-2 bg-black/70 font-mono text-white tabular-nums">
            {fmtTime(film.voEnd)}
          </Badge>
        </div>
        <div className="grid gap-2 p-4">
          <div className="font-mono text-xs text-muted-foreground">{film.name}</div>
          <div className="line-clamp-2 leading-snug font-medium">{film.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{film.shots} shots</span>
            <span>{film.avgShot ? `${film.avgShot.toFixed(2)} s avg` : "—"}</span>
            <LengthBadge voEnd={film.voEnd} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1" title="narrate · plan · audio · shots · render">
            {stages.map(([k, s]) => (
              <span key={k} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <StateIcon state={s} className="size-3.5" />
                {k}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </a>
  )
}

export function Dashboard({ films, onCreated }: { films: FilmSummary[] | null; onCreated: () => void }) {
  const list = films ?? []
  const total = list.reduce((n, f) => n + (f.voEnd ?? 0), 0)
  const shots = list.reduce((n, f) => n + f.shots, 0)
  const rendered = list.filter((f) => f.files.render).length
  const stale = list.filter((f) => pipeline(f).render === "stale").length
  const latest = Math.max(0, ...list.map((f) => f.files.render ?? 0))

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Films</h1>
          <p className="text-sm text-muted-foreground">
            Vertical 9:16 shorts, 2–3 minutes, narrated in a cloned voice.
          </p>
        </div>
        <NewFilmDialog onCreated={onCreated}>
          <Button>
            <Plus /> New film
          </Button>
        </NewFilmDialog>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {films ? (
          <>
            <Stat icon={Film} label="Films" value={String(list.length)} hint={`${rendered} rendered · ${stale} out of date`} />
            <Stat icon={Timer} label="Total runtime" value={fmtTime(total).replace(/\.\d$/, "")} hint="narration across all films" />
            <Stat icon={Scissors} label="Shots" value={String(shots)} hint={`${total && shots ? (total / shots).toFixed(2) : "—"} s average · target 1.6–2.1`} />
            <Stat icon={Clapperboard} label="Last render" value={fmtAgo(latest)} hint="most recent MP4 in renders/" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {films
          ? list.map((f) => <FilmCard key={f.name} film={f} />)
          : Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-xl" />)}
      </div>
    </div>
  )
}
