# Film Studio

A local web app for the films in `../outputs/`, built with Vite, React, Tailwind v4 and
[shadcn/ui](https://ui.shadcn.com). Light, dark and system themes (toggle in the top right).

```bash
npm install        # once
npm run dev        # http://127.0.0.1:3100 — app and API in one process
npm run build && npm start   # production build served by server/serve.mjs (PORT, HOST env vars)
```

## What it does

- **Dashboard**: every film with a snapshot thumbnail, narration length, shot count, average shot
  length and the state of each pipeline stage. Flags films outside the default 2–3 minutes.
- **Film page**: the rendered MP4 in a 9:16 player, and four tabs:
  - **Pipeline**: narrate (or legacy voice) → plan → audio → check → shots → render, each marked
    *up to date*, *out of date* (an input file is newer) or *not built*, with a Run button. The
    legacy ElevenLabs step and Build ask for confirmation.
  - **Script**: every story line with its cut time (click to seek the player), cut marks, big
    words and mood changes.
  - **Shots**: the latest snapshot of every shot; click frames to pick them and re-shoot only those.
  - **Runs**: live logs of jobs (server-sent events), with Stop.
- **New film**: same as `npm run film new <name> "Title"`, plus the narration language
  (`"lang"`) and an optional AI agent that writes `story.json` and `film.js` from a story idea.
  With an agent, the folder name and title are optional: an empty name is made from the title,
  else the first words of the idea, else `film-<date>-<time>` (with `-2`, `-3`… if taken), and
  with no title the agent chooses one and writes it into `story.json`.
  The agent runs as a job you can follow in **Runs**.

## AI agents

`STUDIO_AGENTS` (default `agy,codex,claude`) lists the agents the dialog offers, in order. Set it in
`studio/.env` (copy `.env.example`) or the shell, then restart the server. Unknown names are
ignored, and agents whose CLI is not on `PATH` show as *not installed*.

| Agent | Command (run in the repo root) | Models offered |
|---|---|---|
| `agy` | `agy --mode accept-edits --print-timeout 30m [--model M] -p <prompt>` | `agy models` |
| `codex` | `codex exec --sandbox workspace-write --skip-git-repo-check -C <repo> [-m M] <prompt>` | `codex debug models` (those its picker lists) |
| `claude` | `claude -p <prompt> --permission-mode acceptEdits --allowedTools Read,Write,Edit,Glob,Grep [--model M]` | aliases `opus`, `sonnet`, `haiku`, `fable` |

The **Model** picker always starts with *Default*, which passes no model flag so the CLI's own
setting applies. Listed models are cached for 10 minutes. `STUDIO_MODELS_<AGENT>` (for example
`STUDIO_MODELS_CLAUDE=opus,claude-sonnet-5-5`) replaces an agent's list. The server only accepts a
model that is in the list it offers.

The prompt (`storyPrompt` in `server/api.mjs`) points the agent at `AGENTS.md`, `analysis/ANALYSIS.md`,
the engine and a finished film, and tells it to change only `outputs/<name>/`, never read
`.env.local`, and not run narration, audio or renders. Review the script, then run the pipeline.

## How it works

`server/api.mjs` reads `outputs/<film>/` (story.json, plan.json, file times, snapshots) and runs
`node core/scripts/film.mjs <step> <film>` as child processes, one job per film at a time. It never
reads `.env.local`; the film scripts do that themselves. The server binds to 127.0.0.1 and serves
only `renders/`, `assets/audio/` and `.hyperframes/artifacts/snapshots/` of a film, with range
requests so large renders seek.

| Path | |
|---|---|
| `src/App.tsx` | sidebar layout, header, hash routes (`#/`, `#/film/<name>/<tab>`) |
| `src/components/` | dashboard, film page, job console, dialogs, theme toggle |
| `src/components/ui/` | shadcn components (generated; update with `npx shadcn@latest add`) |

After `npx shadcn add`, check new files in `src/components/ui/` import Radix primitives from
`radix-ui` (`import { Toggle } from "radix-ui"`). shadcn 4.23 wrote `toggle.tsx` and
`toggle-group.tsx` importing `{ Toggle }` / `{ ToggleGroup }` from `@radix-ui/react-toggle*`, which
type-checks but is `undefined` at runtime and blanks the whole page.
| `src/lib/api.ts` | API types, fetchers, formatting, pipeline staleness rules |
| `src/index.css` | shadcn theme tokens for light and dark, plus `brand`, `success`, `warning` |
