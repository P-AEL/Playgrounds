import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import config from "../config.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const apiBaseUrl = process.env.ATLAS_API_URL || (process.env.VERCEL ? "/" : config.apiBaseUrl);
if (apiBaseUrl && apiBaseUrl !== "/") {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("ATLAS_API_URL must be a public HTTPS backend URL without credentials.");
}
await mkdir(output, { recursive: true });
for (const name of ["index.html", "app.js", "style.css", "assets", "lib"]) await cp(path.join(root, name), path.join(output, name), { recursive: true });
await writeFile(path.join(output, "config.js"), `// Public browser configuration.\nexport default ${JSON.stringify({ ...config, apiBaseUrl }, null, 2)};\n`);
await writeFile(path.join(output, ".nojekyll"), "");
console.log("Static site built in dist/. Backend credentials are never included.");
