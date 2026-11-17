import { useState, type ReactNode } from "react"
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
import { api } from "@/lib/api"
import { go } from "@/lib/route"

export function NewFilmDialog({ children, onCreated }: { children: ReactNode; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const valid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    try {
      await api.create(name, title || name)
      toast.success(`Created outputs/${name}`, { description: "Write story/story.json and film.js next." })
      onCreated()
      setOpen(false)
      setName("")
      setTitle("")
      go(`#/film/${name}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New film</DialogTitle>
            <DialogDescription>
              Scaffolds <code className="font-mono">outputs/{name || "<name>"}/</code> from the core template, the same
              as <code className="font-mono">npm run film new</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="film-name">Folder name</Label>
            <Input
              id="film-name"
              placeholder="lost-shadow"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              aria-invalid={name.length > 0 && !valid}
              autoFocus
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="film-title">Title</Label>
            <Input
              id="film-title"
              placeholder="In this town, nobody has a shadow"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? "Creating…" : "Create film"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
