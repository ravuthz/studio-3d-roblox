import { Bot, Cpu, FileCode2 } from "lucide-react"
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
import { api, type Agent } from "@/lib/api"
import { go } from "@/lib/route"

const TEMPLATE = "template"
const CLI_DEFAULT = "cli-default"

export function NewFilmDialog({ children, onCreated }: { children: ReactNode; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [lang, setLang] = useState<"en" | "km">("en")
  const [agent, setAgentState] = useState<string>(TEMPLATE)
  const [model, setModel] = useState<string>(CLI_DEFAULT)
  const [idea, setIdea] = useState("")
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

  // the allowed agents come from STUDIO_AGENTS on the server; refresh each time the dialog opens
  useEffect(() => {
    if (!open) return
    api
      .agents()
      .then((list) => {
        setAgents(list)
        setAgentState((cur) => (cur === TEMPLATE || list.some((a) => a.name === cur && a.installed) ? cur : TEMPLATE))
        setModel((cur) => (cur === CLI_DEFAULT || list.some((a) => a.models.some((m) => m.id === cur)) ? cur : CLI_DEFAULT))
      })
      .catch(() => setAgents([]))
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    try {
      const { film, job } = await api.create({
        name,
        title: title.trim(),
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
            <DialogTitle>New film</DialogTitle>
            <DialogDescription>
              Scaffolds <code className="font-mono">outputs/{name || (useAgent ? "<auto>" : "<name>")}/</code> from the core template, the same
              as <code className="font-mono">npm run film new</code>. An AI agent can then write the story and shots.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="grid gap-2">
              <Label htmlFor="film-name">
                Folder name {useAgent && <Optional />}
              </Label>
              <Input
                id="film-name"
                placeholder={useAgent ? "from the title or idea" : "lost-shadow"}
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                aria-invalid={name.length > 0 && !valid}
                autoFocus
                className="font-mono"
              />
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
            <Label htmlFor="film-title">
              Title {useAgent ? <Optional /> : null}
            </Label>
            <Input
              id="film-title"
              placeholder={useAgent ? `${agent} picks one if left empty` : "In this town, nobody has a shadow"}
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
          {useAgent && (
            <div className="grid gap-2">
              <Label htmlFor="film-idea">Story idea</Label>
              <Textarea
                id="film-idea"
                rows={4}
                maxLength={4000}
                placeholder="Optional. e.g. Shadows can walk away from their owners, and Zero's shadow leaves to become famous."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The agent edits only <code className="font-mono">outputs/{name || "<auto>"}/</code>: story.json and
                film.js. It does not narrate or render; run those from Pipeline once you have checked the script.
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? "Creating…" : useAgent ? `Create and write with ${agent}` : "Create film"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const Optional = () => <span className="font-normal text-muted-foreground">(optional)</span>
