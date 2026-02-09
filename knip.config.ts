import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Workspace-specific configurations
  workspaces: {
    // Next.js web app - uses built-in Next.js preset
    "apps/web": {
      entry: [
        "src/app/**/{page,layout,route,loading,error,not-found,default,template}.{ts,tsx}",
        "next.config.{ts,js,mjs}",
        "postcss.config.{ts,js,mjs}",
      ],
      project: ["src/**/*.{ts,tsx}"],
      ignore: ["src/components/ui/**"], // UI component library (shadcn/ui) - components available for use
    },
    // Expo native app - uses built-in Expo preset
    "apps/native": {
      entry: ["app/**/*.{ts,tsx}", "app/**/_layout.{ts,tsx}"],
      project: ["**/*.{ts,tsx,js,jsx}"],
      // Disable Metro plugin - it tries to require() metro.config.js which triggers
      // tailwindcss to resolve a config from the workspace root (cwd), not apps/native.
      metro: false,
      ignore: ["components/ui/**"],
    },
    // API package
    "packages/api": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
    },
    // Auth package
    "packages/auth": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
    },
    // DB package
    "packages/db": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
      ignore: ["src/migrations/**", "**/*.sql"],
    },
    // Google Calendar package
    "packages/google-cal": {
      entry: ["src/index.ts", "src/client.ts"],
      project: ["src/**/*.ts"],
      ignore: ["src/api-client/**"], // Generated API client code
    },
    // Env package
    "packages/env": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
    },
    // Config package - only contains config files, no source code
    "packages/config": {
      entry: [],
      project: [],
    },
  },

  // Ignore patterns that apply globally
  ignore: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/.turbo/**",
    "**/.expo/**",
    "**/build/**",
    "**/coverage/**",
    ".agents/**",
    ".cursor/**",
    "**/src-tauri/**", // Tauri Rust code
    "**/migrations/**", // Database migrations
    "**/*.sql", // SQL files
    "**/routeTree.gen.ts", // Generated route tree
  ],

  // TypeScript project references
  typescript: {
    project: [
      "apps/web/tsconfig.json",
      "apps/native/tsconfig.json",
      "packages/api/tsconfig.json",
      "packages/auth/tsconfig.json",
      "packages/db/tsconfig.json",
      "packages/google-cal/tsconfig.json",
      "packages/env/tsconfig.json",
      "packages/config/tsconfig.base.json",
    ],
  },
};

export default config;
