import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load environment variables from web app
dotenv.config({
  path: "../../apps/web/.env",
});

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // DATABASE_URL is required for drizzle-kit
    url: process.env.DATABASE_URL || "",
  },
});
