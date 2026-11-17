import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

/** Fetch now, again every `ms`, and on demand through `reload()`. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    reload()
    const t = setInterval(() => document.visibilityState === "visible" && reload(), ms)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, reload }
}
