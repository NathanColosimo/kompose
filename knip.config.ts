import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [".agents/**"],
  ignoreBinaries: ["portless", "jq"],
  workspaces: {
    "apps/native": {
      ignore: ["components/ui/**"],
    },
    "apps/web": {
      ignore: ["src/components/ui/**"],
    },
    "packages/google-cal": {
      ignore: ["src/api-client/**"],
    },
    "packages/task-parser": {
      ignore: ["training/**"],
    },
  },
};

export default config;
