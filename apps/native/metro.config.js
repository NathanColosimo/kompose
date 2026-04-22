// Learn more https://docs.expo.io/guides/customizing-metro

import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = import.meta.dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

// Keep Metro's entry-point math rooted at the app instead of the monorepo.
// We add the workspace folders back manually below so local packages still resolve.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT ??= "1";

const config = getDefaultConfig(projectRoot);

// Package exports resolution can break some packages under Metro.
// Better Auth (and some modern packages) rely on exports subpaths like
// `@better-auth/expo/client`, so we keep this enabled.
config.resolver.unstable_enablePackageExports = true;

const wrappedConfig = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
});

wrappedConfig.watchFolders = [workspaceRoot];
wrappedConfig.resolver.nodeModulesPaths = [
  path.join(projectRoot, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];
wrappedConfig.server.unstable_serverRoot = projectRoot;

export default wrappedConfig;
