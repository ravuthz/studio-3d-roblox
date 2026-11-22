import { Clapperboard, FolderOpen, LayoutDashboard, Loader2, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AutopilotStatus } from "@/components/autopilot-status"
import { NewFilmDialog } from "@/components/new-film-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar"
import { api, fmtTime, type FilmSummary, type SeriesInfo } from "@/lib/api"
import type { Route } from "@/lib/route"

/** films grouped by series (episodes numbered by creation order), then films without a series */
function groupBySeries(films: FilmSummary[], series: SeriesInfo[]) {
  const byAge = [...films].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
  const known = new Set(series.map((s) => s.id))
  const groups: { id: string | null; label: string; films: FilmSummary[] }[] = series.map((s) => ({
    id: s.id,
    label: s.label,
    films: byAge.filter((f) => f.series === s.id),
  }))
  const other = films.filter((f) => !f.series || !known.has(f.series))
  if (other.length) groups.push({ id: null, label: "Other films", films: other })
  return groups
}

export function AppSidebar({ films, route, onCreated }: { films: FilmSummary[] | null; route: Route; onCreated: () => void }) {
  const [series, setSeries] = useState<SeriesInfo[]>([])
  useEffect(() => {
    api.series().then(setSeries).catch(() => {})
  }, [])
  const groups = films ? groupBySeries(films, series) : []
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
                  <Clapperboard className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Film Studio</span>
                  <span className="truncate text-xs text-muted-foreground">3D story films</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={route.page === "home"} tooltip="Dashboard">
                  <a href="#/">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!films && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {Array.from({ length: 6 }, (_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {films &&
          groups.map((g) => (
            <SidebarGroup key={g.id ?? "other"}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <NewFilmDialog onCreated={onCreated} defaultSeries={g.id ?? undefined}>
                <SidebarGroupAction title={g.id ? `New ${g.label} episode` : "New film"}>
                  <Plus />
                  <span className="sr-only">New film</span>
                </SidebarGroupAction>
              </NewFilmDialog>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.films.map((f, i) => (
                    <SidebarMenuItem key={f.name}>
                      <SidebarMenuButton
                        asChild
                        isActive={route.page === "film" && route.name === f.name}
                        tooltip={f.title || f.name}
                        className="pr-12"
                      >
                        <a href={`#/film/${f.name}`}>
                          {f.running ? <Loader2 className="animate-spin text-brand" /> : <Clapperboard />}
                          <span>{g.id ? `Ep ${i + 1} · ${f.title || f.name}` : f.name}</span>
                        </a>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="font-mono text-muted-foreground tabular-nums">
                        {f.voEnd ? fmtTime(f.voEnd).replace(/\.\d$/, "") : "—"}
                      </SidebarMenuBadge>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>

      <SidebarFooter>
        <AutopilotStatus onChange={onCreated} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              tooltip="Open outputs/ folder"
              className="text-xs text-muted-foreground"
              onClick={() => api.openOutputs().catch((e) => toast.error(e.message))}
            >
              <FolderOpen />
              <span className="truncate">
                Films live in <code className="font-mono text-foreground">outputs/</code>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
