import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      outDir: "dist/main",
      rollupOptions: {
        input: resolve("src/main.ts"),
        output: { entryFileNames: "index.js" },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: "dist/preload",
      rollupOptions: {
        input: resolve("src/preload.ts"),
        output: { entryFileNames: "index.cjs", format: "cjs" },
      },
    },
  },
});
