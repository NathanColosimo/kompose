import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load environment variables from web app if not already present
// This allows it to work in Vercel (where env vars are in process.env) and locally (where they are in .env)
if (!process.env.DATABASE_URL) {
  dotenv.config({
    path: "../../apps/web/.env",
  });
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: Ensure DB
        url: process.env.DATABASE_URL!,
  },
});
