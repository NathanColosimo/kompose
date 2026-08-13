import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [".agents/**"],
  ignoreBinaries: ["eas", "hdiutil", "portless", "vercel"],
  workspaces: {
    "packages/google-cal": {
      ignore: ["src/api-client/**"],
    },
  },
};

export default config;
