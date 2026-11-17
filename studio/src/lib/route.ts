import { useEffect, useState } from "react"

export type Route = { page: "home" } | { page: "film"; name: string; tab: string }

function parse(): Route {
  const [, page, name, tab] = window.location.hash.split("/")
  if (page === "film" && name) return { page: "film", name, tab: tab || "overview" }
  return { page: "home" }
}

/** Hash routing: #/ is the dashboard, #/film/<name>/<tab> is a film. */
export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

export const go = (hash: string) => {
  window.location.hash = hash
}
