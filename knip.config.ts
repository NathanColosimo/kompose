import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [".agents/**"],
  ignoreBinaries: ["portless", "jq"],
  workspaces: {
    // electron-vite builds the preload as its own bundle, which main.ts loads by path.
    "apps/electron": {
      entry: ["src/main.ts", "src/preload.ts"],
    },
    // @expo/fingerprint reads this file by name. It comes with expo, and the
    // file only imports it for a JSDoc type.
    "apps/native": {
      entry: ["fingerprint.config.js"],
      ignoreDependencies: ["@expo/fingerprint"],
      ignore: ["components/ui/**"],
    },
    "apps/web": {
      ignore: ["src/components/ui/**"],
    },
    "packages/google-cal": {
      ignore: ["src/api-client/**"],
    },
    // build-kernel.ts is run by hand to regenerate src/model/kernel-wasm.ts.
    "packages/task-parser": {
      entry: ["scripts/build-kernel.ts"],
      ignore: ["training/**"],
    },
  },
};

export default config;
