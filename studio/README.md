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
- **New film**: same as `npm run film new <name> "Title"`.

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
| `src/lib/api.ts` | API types, fetchers, formatting, pipeline staleness rules |
| `src/index.css` | shadcn theme tokens for light and dark, plus `brand`, `success`, `warning` |
