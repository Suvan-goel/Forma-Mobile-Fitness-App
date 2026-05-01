const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * MediaPipe task assets should be stored uncompressed in Android packages.
 * This keeps asset-file access predictable for native model loading in release builds.
 */
function withUncompressedPoseTasks(config) {
  return withAppBuildGradle(config, (config) => {
    const noCompressRule = "        noCompress += ['task']";
    let contents = config.modResults.contents;

    if (/noCompress\s*(\+=)?\s*(\[)?[^\n]*['"]task['"]/.test(contents)) {
      return config;
    }

    if (/androidResources\s*\{/.test(contents)) {
      config.modResults.contents = contents.replace(
        /(androidResources\s*\{\n)/,
        `$1${noCompressRule}\n`
      );
      return config;
    }

    const packagingOptionsBlock = /(\n    packagingOptions\s*\{[\s\S]*?\n    \}\n)/;
    if (packagingOptionsBlock.test(contents)) {
      config.modResults.contents = contents.replace(
        packagingOptionsBlock,
        `$1    androidResources {\n${noCompressRule}\n    }\n`
      );
    }

    return config;
  });
}

module.exports = withUncompressedPoseTasks;
