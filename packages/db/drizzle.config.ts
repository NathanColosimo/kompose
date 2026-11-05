import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const configDir = fileURLToPath(new URL(".", import.meta.url));

// Local CLI runs use the web app's .env when DATABASE_URL isn't provided.
if (!process.env.DATABASE_URL) {
  process.loadEnvFile(resolve(configDir, "../../apps/web/.env"));
}

export default defineConfig({
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: Ensure DB
    url: process.env.DATABASE_URL!,
  },
  dialect: "postgresql",
  out: "./src/migrations",
  schema: "./src/schema",
});
