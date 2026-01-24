module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets-core/plugin',
      // vision-camera-resize-plugin removed - has babel compatibility issues
      'react-native-reanimated/plugin',
    ],
  };
};

