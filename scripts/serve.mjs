import http from "node:http";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8" };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root) || relative.split(/[\\/]/).some(p => p.startsWith(".")) || relative.split(/[\\/]/).includes("node_modules")) { res.writeHead(403).end(); return; }
    if (!(await stat(absolute)).isFile()) { res.writeHead(404).end(); return; }
    const data = await readFile(absolute);
    res.writeHead(200, { "Content-Type": types[path.extname(absolute)] ?? "application/octet-stream", "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin" });
    res.end(data);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}`));
