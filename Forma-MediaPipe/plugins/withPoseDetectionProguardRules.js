const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const BEGIN = '# Forma pose detection keep rules';
const END = '# End Forma pose detection keep rules';

const RULES = `${BEGIN}
-keep class expo.modules.posedetection.** { *; }
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-keep class com.google.flatbuffers.** { *; }
-keep class org.tensorflow.lite.** { *; }

-dontwarn com.google.mediapipe.**
-dontwarn com.google.protobuf.**
-dontwarn com.google.flatbuffers.**
-dontwarn org.tensorflow.lite.**
${END}
`;

function upsertRules(contents) {
  const blockPattern = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`);
  if (blockPattern.test(contents)) {
    return contents.replace(blockPattern, RULES);
  }

  const trimmed = contents.replace(/\s*$/, '');
  return `${trimmed}\n\n${RULES}`;
}

function withPoseDetectionProguardRules(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const proguardPath = path.join(
      config.modRequest.projectRoot,
      'android',
      'app',
      'proguard-rules.pro'
    );

    let contents = '';
    try {
      contents = await fs.promises.readFile(proguardPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await fs.promises.mkdir(path.dirname(proguardPath), { recursive: true });
    await fs.promises.writeFile(proguardPath, upsertRules(contents), 'utf8');

    return config;
  }]);
}

module.exports = withPoseDetectionProguardRules;
