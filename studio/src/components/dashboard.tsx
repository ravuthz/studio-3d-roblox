import { Clapperboard, Film, Grid2x2, Grid3x3, Plus, Scissors, Timer } from "lucide-react"
import { useState } from "react"

import { NewFilmDialog } from "@/components/new-film-dialog"
import { LengthBadge, StateIcon, StyleBadge } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmtAgo, fmtTime, media, pipeline, type FilmSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

type PerRow = "4" | "8"
const PER_ROW_KEY = "film-studio-per-row"

/** Cards per row on laptop screens and up (lg); remembered per browser. */
function usePerRow() {
  const [perRow, setPerRow] = useState<PerRow>(() => {
    try {
      return localStorage.getItem(PER_ROW_KEY) === "8" ? "8" : "4"
    } catch {
      return "4"
    }
  })
  const choose = (v: string) => {
    if (v !== "4" && v !== "8") return // clicking the active item deselects it: keep the current choice
    setPerRow(v)
    try {
      localStorage.setItem(PER_ROW_KEY, v)
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  }
  return [perRow, choose] as const
}

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

function FilmCard({ film, dense }: { film: FilmSummary; dense: boolean }) {
  const p = pipeline(film)
  const stages = Object.entries(p) as [keyof typeof p, (typeof p)[keyof typeof p]][]
  return (
    <a href={`#/film/${film.name}`} title={film.title} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
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
          {/* title floats over the top of the picture on one line, and steps aside on hover so the frame shows */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/40 to-transparent px-3 pt-2.5 pb-8 text-center transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0",
              dense && "lg:px-2 lg:pt-1.5 lg:pb-5",
            )}
          >
            <div
              className={cn(
                "truncate text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]",
                dense && "lg:text-[11px]",
              )}
            >
              {film.title}
            </div>
          </div>
          <div className={cn("absolute bottom-2 left-2 flex gap-1", dense && "lg:hidden")}>
            <Badge className="border-transparent bg-black/70 font-mono text-white uppercase">{film.lang ?? "en · 11labs"}</Badge>
            <StyleBadge style={film.style} className="border-transparent bg-black/70 text-white" />
          </div>
          <Badge className={cn("absolute right-2 bottom-2 bg-black/70 font-mono text-white tabular-nums", dense && "lg:right-1.5 lg:bottom-1.5 lg:h-4 lg:px-1.5 lg:text-[10px]")}>
            {fmtTime(film.voEnd)}
          </Badge>
        </div>
        <div className={cn("grid gap-2 p-4", dense && "lg:gap-1 lg:p-2.5")}>
          <div className={cn("font-mono text-xs text-muted-foreground", dense && "lg:truncate lg:text-[11px]")}>{film.name}</div>
          <div className={cn("mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", dense && "lg:hidden")}>
            <span>{film.shots} shots</span>
            <span>{film.avgShot ? `${film.avgShot.toFixed(2)} s avg` : "—"}</span>
            <LengthBadge voEnd={film.voEnd} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1" title="narrate · plan · audio · shots · render">
            {stages.map(([k, s]) => (
              <span key={k} title={k} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <StateIcon state={s} className="size-3.5" />
                <span className={cn(dense && "lg:sr-only")}>{k}</span>
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
  const [perRow, setPerRow] = usePerRow()
  const dense = perRow === "8"

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Films</h1>
          <p className="text-sm text-muted-foreground">
            Vertical 9:16 shorts, 2–3 minutes, narrated in a cloned voice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            value={perRow}
            onValueChange={setPerRow}
            aria-label="Films per row"
            className="hidden lg:flex"
          >
            <ToggleGroupItem value="4" aria-label="4 films per row" title="4 per row">
              <Grid2x2 /> 4
            </ToggleGroupItem>
            <ToggleGroupItem value="8" aria-label="8 films per row" title="8 per row">
              <Grid3x3 /> 8
            </ToggleGroupItem>
          </ToggleGroup>
          <NewFilmDialog onCreated={onCreated}>
            <Button>
              <Plus /> New film
            </Button>
          </NewFilmDialog>
        </div>
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

      <div className={cn("grid grid-cols-2 gap-4 md:grid-cols-3", dense ? "lg:grid-cols-8 lg:gap-3" : "lg:grid-cols-4")}>
        {films
          ? list.map((f) => <FilmCard key={f.name} film={f} dense={dense} />)
          : Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-xl" />)}
      </div>
    </div>
  )
}
