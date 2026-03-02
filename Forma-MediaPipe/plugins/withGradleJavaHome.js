const { withGradleProperties } = require('expo/config-plugins');

/**
 * Expo config plugin that sets org.gradle.java.home in android/gradle.properties.
 * This survives `npx expo prebuild --clean` so the value doesn't need to be re-added manually.
 */
function withGradleJavaHome(config, javaHome) {
  return withGradleProperties(config, (config) => {
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
