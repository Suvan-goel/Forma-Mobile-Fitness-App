module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Removed react-native-worklets-core/plugin - not used in app
      // Removed react-native-reanimated/plugin - not used in app
      // These were causing iOS Hermes crash: "Cannot read property 'S' of undefined"
    ],
  };
};

