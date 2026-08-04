// Learn more https://docs.expo.io/guides/customizing-metro

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = import.meta.dirname;
const config = getDefaultConfig(projectRoot);

export default withUniwindConfig(config, {
  cssEntryFile: "./global.css",
});
