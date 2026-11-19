import { Clapperboard, FolderOpen, LayoutDashboard, Loader2, Plus } from "lucide-react"
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
import { api, fmtTime, type FilmSummary } from "@/lib/api"
import type { Route } from "@/lib/route"

export function AppSidebar({ films, route, onCreated }: { films: FilmSummary[] | null; route: Route; onCreated: () => void }) {
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
                  <span className="truncate text-xs text-muted-foreground">3D blocky story films</span>
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

        <SidebarGroup>
          <SidebarGroupLabel>Films</SidebarGroupLabel>
          <NewFilmDialog onCreated={onCreated}>
            <SidebarGroupAction title="New film">
              <Plus />
              <span className="sr-only">New film</span>
            </SidebarGroupAction>
          </NewFilmDialog>
          <SidebarGroupContent>
            <SidebarMenu>
              {!films &&
                Array.from({ length: 6 }, (_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))}
              {films?.map((f) => (
                <SidebarMenuItem key={f.name}>
                  <SidebarMenuButton
                    asChild
                    isActive={route.page === "film" && route.name === f.name}
                    tooltip={f.title}
                  >
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
