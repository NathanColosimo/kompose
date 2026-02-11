// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const config = getDefaultConfig(import.meta.dirname);
const appNodeModules = path.resolve(import.meta.dirname, "node_modules");
const workspaceNodeModules = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "node_modules"
);

/**
 * Monorepo + Bun:
 * Dependencies are typically hoisted to the repo root `node_modules/`.
 * Explicitly add it so Metro can resolve packages like `lucide-react-native`.
 */
config.resolver.nodeModulesPaths = [appNodeModules, workspaceNodeModules];

// Bun installs can expose the same package through different symlink paths.
// Force all modules (including react-hook-form) to resolve React from one path
// to prevent invalid hook calls from duplicate React module instances.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(appNodeModules, "react"),
  "react/jsx-runtime": path.join(appNodeModules, "react/jsx-runtime.js"),
  "react/jsx-dev-runtime": path.join(
    appNodeModules,
    "react/jsx-dev-runtime.js"
  ),
  "react-hook-form": path.join(appNodeModules, "react-hook-form"),
};

// Package exports resolution can break some packages under Metro.
// Better Auth (and some modern packages) rely on exports subpaths like
// `@better-auth/expo/client`, so we keep this enabled.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, {
  input: "./global.css",
  inlineRem: 16,
  // Explicitly point to the TS config so darkMode flags are loaded.
  configPath: "./tailwind.config.ts",
});
