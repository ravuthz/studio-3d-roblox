import { Bot, Cpu, FileCode2, Loader2, Rocket, Shuffle, Sparkles } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, type Agent, type SeriesInfo } from "@/lib/api"
import { go } from "@/lib/route"

const TEMPLATE = "template"
const CLI_DEFAULT = "cli-default"

export function NewFilmDialog({
  children,
  onCreated,
  defaultSeries,
}: {
  children: ReactNode
  onCreated: () => void
  defaultSeries?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [seriesList, setSeriesList] = useState<SeriesInfo[]>([])
  const [series, setSeries] = useState<string>("family")
  const [lang, setLang] = useState<"en" | "km">("en")
  const [agent, setAgentState] = useState<string>(TEMPLATE)
  const [model, setModel] = useState<string>(CLI_DEFAULT)
  const [idea, setIdea] = useState("")
  const [seen, setSeen] = useState<string[]>([])
  const [generating, setGenerating] = useState<"instant" | "ai" | null>(null)
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const useAgent = agent !== TEMPLATE
  // with an agent, an empty folder name is filled in by the server and the agent picks the title
  const valid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(name) || (useAgent && name === "")
  const agentModels = agents?.find((a) => a.name === agent)?.models ?? []
  // a different agent has different models: start again from its default
  const setAgent = (a: string) => {
    setAgentState(a)
    setModel(CLI_DEFAULT)
  }

  // the allowed agents and series come from the server; refresh each time the dialog opens
  useEffect(() => {
    if (!open) return
    if (defaultSeries) setSeries(defaultSeries)
    api
      .agents()
      .then((list) => {
        setAgents(list)
        setAgentState((cur) => (cur === TEMPLATE || list.some((a) => a.name === cur && a.installed) ? cur : TEMPLATE))
        setModel((cur) => (cur === CLI_DEFAULT || list.some((a) => a.models.some((m) => m.id === cur)) ? cur : CLI_DEFAULT))
      })
      .catch(() => setAgents([]))
    api
      .series()
      .then((list) => {
        setSeriesList(list)
        setSeries((cur) => (list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? "family")))
      })
      .catch(() => {})
  }, [open, defaultSeries])

  async function fillTopic(withAgent: boolean) {
    setGenerating(withAgent ? "ai" : "instant")
    try {
      const avoid = [...seen, name, title.trim()].filter(Boolean)
      const topic = await api.topic({
        agent: withAgent ? agent : null,
        model: withAgent && model !== CLI_DEFAULT ? model : null,
        avoid,
        series,
      })
      setName(topic.name)
      setTitle(topic.title)
      setIdea(topic.idea)
      setLang("en")
      setSeen((prev) => [...prev.slice(-40), topic.name, topic.title])
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGenerating(null)
    }
  }

  // topic -> film -> story and shots -> build -> MP4, with no further confirmation
  async function autopilot() {
    setBusy(true)
    try {
      const state = await api.startAuto({
        agent: useAgent ? agent : null,
        model: useAgent && model !== CLI_DEFAULT ? model : null,
        lang,
        series,
        count: 1,
      })
      toast.success("Autopilot started", {
        description: `${state.agent} picks the next topic, writes it, then narrate → plan → audio → check → render. Follow it in the sidebar.`,
      })
      setOpen(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || generating) return
    setBusy(true)
    try {
      const { film, job } = await api.create({
        name,
        title: title.trim(),
        series,
        lang,
        agent: useAgent ? agent : null,
        model: useAgent && model !== CLI_DEFAULT ? model : null,
        idea,
      })
      if (job) toast.success(`Created outputs/${film.name}`, { description: `${agent} is writing the story and shots. Follow it in Runs.` })
      else toast.success(`Created outputs/${film.name}`, { description: "Write story/story.json and film.js next." })
      onCreated()
      setOpen(false)
      setName("")
      setTitle("")
      setIdea("")
      setSeen([])
      go(job ? `#/film/${film.name}/runs` : `#/film/${film.name}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
              <DialogTitle>New film</DialogTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => fillTopic(false)}
                  disabled={busy || generating !== null}
                  title="Generate a fresh English title, folder name, and story idea"
                >
                  {generating === "instant" ? <Loader2 className="animate-spin" /> : <Shuffle />}
                  Auto topic
                </Button>
                {useAgent && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => fillTopic(true)}
                    disabled={busy || generating !== null}
                    title={`Ask ${agent} to invent a brand-new topic`}
                  >
                    {generating === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {generating === "ai" ? `Asking ${agent}…` : `Ask ${agent}`}
                  </Button>
                )}
              </div>
            </div>
            <DialogDescription>
              Scaffolds <code className="font-mono">outputs/{name || (useAgent ? "<auto>" : "<name>")}/</code> from the core template, the same
              as <code className="font-mono">npm run film new</code>. An AI agent can then write the story and shots.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="film-series">Series</Label>
              <Select value={series} onValueChange={setSeries}>
                <SelectTrigger id="film-series" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(seriesList.length
                    ? seriesList
                    : [
                        { id: "family", label: "Family" },
                        { id: "lover", label: "Lover" },
                      ]
                  ).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="film-lang">Narration</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as "en" | "km")}>
                <SelectTrigger id="film-lang" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="km">Khmer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="film-name">
              Folder name {useAgent && <Optional />}
            </Label>
            <Input
              id="film-name"
              placeholder={useAgent ? "from the title or idea" : "biscuit-bath-day"}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              aria-invalid={name.length > 0 && !valid}
              autoFocus
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="film-title">
              Title {useAgent ? <Optional /> : null}
            </Label>
            <Input
              id="film-title"
              placeholder={useAgent ? `${agent} picks one if left empty` : "Dad made a chore wheel"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className={useAgent ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="film-agent">Write with</Label>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger id="film-agent" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPLATE}>
                    <FileCode2 /> Empty template (write it yourself)
                  </SelectItem>
                  {!agents && (
                    <SelectItem value="loading" disabled>
                      Loading agents…
                    </SelectItem>
                  )}
                  {agents?.map((a) => (
                    <SelectItem key={a.name} value={a.name} disabled={!a.installed}>
                      <Bot /> <span className="font-mono">{a.name}</span>
                      {!a.installed && <span className="text-muted-foreground">not installed</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agents && agents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No agents allowed. Set <code className="font-mono">STUDIO_AGENTS</code> in{" "}
                  <code className="font-mono">studio/.env</code>.
                </p>
              )}
            </div>
            {useAgent && (
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="film-model">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  {/* the closed field shows the label only; the id is listed in the menu */}
                  <SelectTrigger id="film-model" className="w-full min-w-0 [&_.model-id]:hidden">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={CLI_DEFAULT}>
                      <Cpu /> Default ({agent} setting)
                    </SelectItem>
                    {agentModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span>{m.label}</span>
                        {m.label !== m.id && <span className="model-id font-mono text-xs text-muted-foreground">{m.id}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="film-idea">
              Story idea <Optional />
            </Label>
            <Textarea
              id="film-idea"
              rows={4}
              maxLength={4000}
              placeholder="e.g. Mira announces bath day and Biscuit immediately vanishes."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {useAgent ? (
                <>
                  The agent edits only <code className="font-mono">outputs/{name || "<auto>"}/</code>: story.json and
                  film.js. It does not narrate or render; run those from Pipeline once you have checked the script.
                </>
              ) : (
                <>
                  Saved in <code className="font-mono">outputs/{name || "<name>"}/meta.json</code> as your outline, or
                  pick an AI agent above to write <code className="font-mono">story.json</code> and{" "}
                  <code className="font-mono">film.js</code> from it.
                </>
              )}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="secondary"
              onClick={autopilot}
              disabled={busy || generating !== null || agents?.every((a) => !a.installed)}
              title="Pick the next topic and make the finished video without asking again"
            >
              <Rocket /> Autopilot to video
            </Button>
            <Button type="submit" disabled={!valid || busy || generating !== null}>
              {busy ? "Creating…" : useAgent ? `Create and write with ${agent}` : "Create film"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const Optional = () => <span className="font-normal text-muted-foreground">(optional)</span>
