// Side-effect import for scripts: load .env.local then .env (first one wins per
// key, matching Next.js precedence). Real process env always takes priority.
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
