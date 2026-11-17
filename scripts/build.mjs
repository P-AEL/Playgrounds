import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
for (const name of ["index.html", "app.js", "style.css", "config.js", "assets", "lib"]) await cp(path.join(root, name), path.join(output, name), { recursive: true });
if (process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) throw new Error("Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (key.startsWith("sb_secret_")) throw new Error("A Supabase secret key must never be published.");
  if (!key.startsWith("sb_publishable_")) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()); } catch { throw new Error("Use a public publishable or anon key."); }
    if (payload.role !== "anon") throw new Error("Only a publishable or anon key is safe for the browser.");
  }
  if (new URL(process.env.SUPABASE_URL).protocol !== "https:") throw new Error("Supabase requires an HTTPS URL.");
  const original = await readFile(path.join(root, "config.js"), "utf8");
  await writeFile(path.join(output, "config.js"), original
    .replace(/supabaseUrl:\s*"[^"]*"/, `supabaseUrl: ${JSON.stringify(process.env.SUPABASE_URL)}`)
    .replace(/supabaseKey:\s*"[^"]*"/, `supabaseKey: ${JSON.stringify(key)}`));
}
await writeFile(path.join(output, ".nojekyll"), "");
console.log("Static site built in dist/ (GitHub Pages subpaths supported).");
