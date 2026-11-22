import { Clapperboard, FolderOpen, LayoutDashboard, ListFilter, Loader2, Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { AutopilotStatus } from "@/components/autopilot-status"
import { NewFilmDialog } from "@/components/new-film-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { api, fmtTime, type FilmSummary, type SeriesInfo, type Style } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Route } from "@/lib/route"

const ALL = "all"
const NONE = "none" // films made before series existed
const SAVED = "studio.sidebar.filter"

/** the sidebar's film filter, kept across reloads */
function useFilter() {
  const [filter, setFilter] = useState<{ series: string; style: string }>(() => {
    try {
      return { series: ALL, style: ALL, ...JSON.parse(localStorage.getItem(SAVED) || "{}") }
    } catch {
      return { series: ALL, style: ALL }
    }
  })
  useEffect(() => {
    localStorage.setItem(SAVED, JSON.stringify(filter))
  }, [filter])
  return [filter, setFilter] as const
}

export function AppSidebar({ films, route, onCreated }: { films: FilmSummary[] | null; route: Route; onCreated: () => void }) {
  const [series, setSeries] = useState<SeriesInfo[]>([])
  const [styles, setStyles] = useState<Style[]>([])
  const [filter, setFilter] = useFilter()
  useEffect(() => {
    api.series().then(setSeries).catch(() => {})
    api.styles().then(setStyles).catch(() => {})
  }, [])
  // a saved filter for a series or style that no longer exists counts as "all"
  const bySeries = filter.series === NONE || series.some((x) => x.id === filter.series) ? filter.series : ALL
  const byStyle = styles.some((x) => x.id === filter.style) ? filter.style : ALL
  const active = (bySeries !== ALL ? 1 : 0) + (byStyle !== ALL ? 1 : 0)
  const shown = useMemo(
    () =>
      (films ?? []).filter(
        (f) =>
          (bySeries === ALL || (bySeries === NONE ? !f.series : f.series === bySeries)) && (byStyle === ALL || f.style === byStyle),
      ),
    [films, bySeries, byStyle],
  )
  const clear = () => setFilter({ series: ALL, style: ALL })
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
        {films && (
          <SidebarGroup>
            <SidebarGroupLabel>
              Films
              <span className="ml-1.5 font-mono tabular-nums">{active ? `${shown.length}/${films.length}` : films.length}</span>
            </SidebarGroupLabel>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarGroupAction title="Filter films" className={cn("right-9", active > 0 && "text-brand")}>
                  <ListFilter />
                  <span className="sr-only">Filter films{active ? ` (${active} active)` : ""}</span>
                </SidebarGroupAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-48">
                <DropdownMenuLabel>Series</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={bySeries} onValueChange={(v) => setFilter({ ...filter, series: v })}>
                  <DropdownMenuRadioItem value={ALL}>All series</DropdownMenuRadioItem>
                  {series.map((x) => (
                    <DropdownMenuRadioItem key={x.id} value={x.id}>
                      {x.label}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value={NONE}>No series</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Style</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={byStyle} onValueChange={(v) => setFilter({ ...filter, style: v })}>
                  <DropdownMenuRadioItem value={ALL}>All styles</DropdownMenuRadioItem>
                  {styles.map((x) => (
                    <DropdownMenuRadioItem key={x.id} value={x.id}>
                      {x.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {active > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={clear}>Clear filters</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* a new film starts in the series the list is filtered to */}
            <NewFilmDialog onCreated={onCreated} defaultSeries={bySeries !== ALL && bySeries !== NONE ? bySeries : undefined}>
              <SidebarGroupAction title="New film">
                <Plus />
                <span className="sr-only">New film</span>
              </SidebarGroupAction>
            </NewFilmDialog>
            <SidebarGroupContent>
              <SidebarMenu>
                {shown.map((f) => (
                  <SidebarMenuItem key={f.name}>
                    <SidebarMenuButton asChild isActive={route.page === "film" && route.name === f.name} tooltip={f.title || f.name} className="pr-12">
                      <a href={`#/film/${f.name}`}>
                        {f.running ? <Loader2 className="animate-spin text-brand" /> : <Clapperboard />}
                        <span>{f.name}</span>
                      </a>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="font-mono text-muted-foreground tabular-nums">
                      {f.voEnd ? fmtTime(f.voEnd).replace(/\.\d$/, "") : "—"}
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
                {shown.length === 0 && (
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                      {films.length === 0 ? "No films yet." : "No films match the filter."}
                      {active > 0 && (
                        <button type="button" onClick={clear} className="ml-1 underline underline-offset-2 hover:text-foreground">
                          Clear
                        </button>
                      )}
                    </div>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
