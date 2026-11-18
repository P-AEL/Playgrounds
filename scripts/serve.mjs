import http from "node:http";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import config from "../config.js";
import { loadLocalEnvironment } from "../server/env.mjs";
import { closeDatabase } from "../server/mongo.mjs";
import handler from "../api/atlas.js";

loadLocalEnvironment();
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const root = process.env.NODE_ENV === "production" ? path.join(projectRoot, "dist") : projectRoot;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/atlas") { await handler(req, res); return; }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    // Serve only public app files, never repo files or local credentials.
    const allowed = ["index.html", "app.js", "style.css", "config.js"].includes(relative) || /^(assets|lib)\/[A-Za-z0-9_./-]+\.(?:js|css|svg|png)$/.test(relative);
    const absolute = path.resolve(root, relative);
    if (!allowed || !absolute.startsWith(root + path.sep) || relative.split(/[\\/]/).some(segment => segment.startsWith("."))) { res.writeHead(404).end("Not found"); return; }
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (relative === "config.js") {
      res.writeHead(200, { "Content-Type": types[".js"] });
      res.end(req.method === "HEAD" ? undefined : `export default ${JSON.stringify({ ...config, apiBaseUrl: "/" })};`); return;
    }
    if (!(await stat(absolute)).isFile()) { res.writeHead(404).end(); return; }
    const data = await readFile(absolute);
    res.writeHead(200, { "Content-Type": types[path.extname(absolute)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch { if (!res.headersSent) res.writeHead(404); res.end("Not found"); }
});
server.listen(port, host, () => console.log(`Playground Atlas: http://${host}:${port}`));
async function stop() { server.close(); await closeDatabase(); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
