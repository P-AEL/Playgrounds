import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Local credentials are never bundled or committed. Production uses host secrets.
export function loadLocalEnvironment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return;
  for (const name of [".env", "atlas-credentials.env"]) {
    try { loadEnvFile(fileURLToPath(new URL(`../${name}`, import.meta.url))); }
    catch (error) { if (error.code !== "ENOENT") throw new Error(`Unable to read local configuration in ${name}.`); }
  }
}
