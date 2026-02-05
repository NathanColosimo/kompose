// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

/**
 * Monorepo + Bun:
 * Dependencies are typically hoisted to the repo root `node_modules/`.
 * Explicitly add it so Metro can resolve packages like `lucide-react-native`.
 */
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "..", "..", "node_modules"),
];

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
