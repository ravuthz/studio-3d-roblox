import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
// @ts-expect-error plain ESM module without types
import { handler } from "./server/api.mjs"

/** Serves /api and /media from the same dev server, so one `npm run dev` is enough. */
const filmApi = (): Plugin => ({
  name: "film-api",
  configureServer(server) {
    server.middlewares.use((req, res, next) => handler(req, res, next))
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), filmApi()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { host: "127.0.0.1", port: 3100 },
})
