import { AppSidebar } from "@/components/app-sidebar"
import { Dashboard } from "@/components/dashboard"
import { FilmPage } from "@/components/film-page"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { api } from "@/lib/api"
import { useRoute } from "@/lib/route"
import { usePoll } from "@/lib/use-poll"

export default function App() {
  const route = useRoute()
  const films = usePoll(api.films, 10000)

  return (
    <SidebarProvider>
      <AppSidebar films={films.data} route={route} onCreated={films.reload} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <a href="#/" className="text-muted-foreground hover:text-foreground">
              Films
            </a>
            {route.page === "film" && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="truncate font-medium">{route.name}</span>
              </>
            )}
          </nav>
          <ModeToggle />
        </header>
        {films.error && (
          <div className="mx-4 mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive md:mx-6">
            API unreachable: {films.error}
          </div>
        )}
        {route.page === "film" ? (
          <FilmPage key={route.name} name={route.name} tab={route.tab} onChanged={films.reload} />
        ) : (
          <Dashboard films={films.data} onCreated={films.reload} />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
