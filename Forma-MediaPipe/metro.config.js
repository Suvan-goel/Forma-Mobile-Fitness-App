const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const { transformer, resolver } = config;

// SVG as component (react-native-svg-transformer)
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
};
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
};

// Ensure .tflite is treated as a bundled asset
config.resolver.assetExts = Array.from(new Set([...(config.resolver.assetExts || []), 'tflite']));

module.exports = config;
