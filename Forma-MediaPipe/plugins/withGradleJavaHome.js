const { withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');

/**
 * Expo config plugin that sets org.gradle.java.home in android/gradle.properties.
 * This survives `npx expo prebuild --clean` so the value doesn't need to be re-added manually.
 * Skipped on EAS/CI where the local Mac JDK path doesn't exist.
 */
function withGradleJavaHome(config, javaHome) {
  return withGradleProperties(config, (config) => {
    if (!fs.existsSync(javaHome)) return config;

    const props = config.modResults;

    // Remove any existing org.gradle.java.home entry to avoid duplicates
    const filtered = props.filter(
      (item) => !(item.type === 'property' && item.key === 'org.gradle.java.home')
    );

    filtered.push({
      type: 'property',
      key: 'org.gradle.java.home',
      value: javaHome,
    });

    config.modResults = filtered;
    return config;
  });
}

module.exports = withGradleJavaHome;
