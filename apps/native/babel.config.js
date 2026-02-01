module.exports = (api) => {
  api.cache(true);

  return {
    // Expo Router + NativeWind:
    // - `nativewind/babel` is a *preset* (it returns `{ plugins: [...] }`), so it must go in `presets`.
    // - `expo-router/babel` is a normal Babel *plugin* (it returns `{ name, visitor }`), so it must go in `plugins`.
    // - `react-native-reanimated/plugin` must always be last in `plugins`.
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],

      // Enables NativeWind transformations for `className`.
      "nativewind/babel",
    ],
    // NOTE:
    // `nativewind/babel` (via `react-native-css-interop/babel`) already includes
    // `"react-native-worklets/plugin"` which is the correct worklet transform for
    // Reanimated v4+. Keeping the old `"react-native-reanimated/plugin"` alongside it
    // can break dev/HMR initialization, so we intentionally omit it here.
    plugins: [],
  };
};
