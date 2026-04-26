const { withAppBuildGradle } = require('expo/config-plugins');

// Restricts native library compilation to arm64-v8a only.
// All physical Android phones since ~2016 are arm64. The other ABIs (x86, x86_64, armeabi-v7a)
// are emulator targets and bloat the APK by ~3x without adding device support.
function withArmOnly(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes('abiFilters')) return config;
    config.modResults.contents = contents.replace(
      /defaultConfig\s*\{/,
      "defaultConfig {\n            ndk {\n                abiFilters 'arm64-v8a'\n            }"
    );
    return config;
  });
}

module.exports = withArmOnly;
