import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Orama-powered document search endpoint used by Fumadocs' built-in search dialog.
export const { GET } = createFromSource(source, {
  language: "english",
});
