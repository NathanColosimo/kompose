import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      outDir: "dist/main",
      rolldownOptions: {
        input: {
          index: resolve("src/main.ts"),
          "local-ai": resolve("src/local-ai.ts"),
        },
        output: { entryFileNames: "[name].js" },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: "dist/preload",
      rolldownOptions: {
        input: resolve("src/preload.ts"),
        output: { entryFileNames: "index.cjs", format: "cjs" },
      },
    },
  },
});
