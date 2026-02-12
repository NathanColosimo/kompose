module.exports = (api) => {
  api.cache(true);

  return {
    // Uniwind + Tailwind v4 does not require a custom Babel preset.
    presets: ["babel-preset-expo"],
    plugins: [],
  };
};
