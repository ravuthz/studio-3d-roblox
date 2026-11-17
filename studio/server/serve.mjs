#!/usr/bin/env node
// Production server: the built app from dist/ plus the API.   npm run build && npm start
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handler } from "./api.mjs";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing: run `npm run build` first (or `npm run dev` while working).");
  process.exit(1);
}

createServer((req, res) => {
  handler(req, res, () => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    let file = resolve(DIST, "." + path);
    if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
}).listen(PORT, HOST, () => console.log(`Film Studio on http://${HOST}:${PORT}`));
