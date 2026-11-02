/**
 * The iOS fingerprint (runtimeVersion) decides between an OTA update and a
 * new App Store binary (documents/ci-cd.md). These are the default
 * "balanced" preset's skips plus PackageJsonScriptsAll: no package.json
 * script runs in an EAS build, so editing one shouldn't ship a binary.
 * A file that fails to load is silently ignored; check the change with
 * `npx expo-updates fingerprint:generate --platform ios`.
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  sourceSkips: [
    "AutolinkingConfigPaths",
    "EasJson",
    "Easignore",
    "ExpoConfigRuntimeVersionIfString",
    "ExpoConfigVersions",
    "PackageJsonScriptsAll",
  ],
};
