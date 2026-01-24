const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure .tflite is treated as a bundled asset
config.resolver.assetExts = Array.from(new Set([...(config.resolver.assetExts || []), 'tflite']));

module.exports = config;
