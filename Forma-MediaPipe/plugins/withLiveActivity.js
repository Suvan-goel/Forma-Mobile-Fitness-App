/**
 * Expo config plugin to add the FormaWidgets widget extension target
 * for Live Activity / Dynamic Island support.
 *
 * This plugin:
 * 1. Adds the NSSupportsLiveActivities key to the main app's Info.plist
 * 2. Adds the widget extension target to the Xcode project
 * 3. Copies widget Swift source files into the build
 * 4. Creates the entitlements file for the widget extension
 */
const { withInfoPlist, withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

const WIDGET_TARGET_NAME = 'FormaWidgets';
const WIDGET_BUNDLE_ID_SUFFIX = '.FormaWidgets';

function withLiveActivity(config) {
  // Step 1: Add NSSupportsLiveActivities to main app Info.plist
  config = withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    return config;
  });

  // Step 2: Copy widget files and add assets
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const iosPath = path.join(config.modRequest.platformProjectRoot);
      const widgetDir = path.join(iosPath, WIDGET_TARGET_NAME);
      const srcDir = path.join(
        config.modRequest.projectRoot,
        'ios-widgets',
        WIDGET_TARGET_NAME
      );

      // Create widget directory
      if (!fs.existsSync(widgetDir)) {
        fs.mkdirSync(widgetDir, { recursive: true });
      }

      // Copy all Swift files and Info.plist
      const filesToCopy = fs.readdirSync(srcDir).filter(
        (f) => f.endsWith('.swift') || f === 'Info.plist'
      );
      for (const file of filesToCopy) {
        fs.copyFileSync(path.join(srcDir, file), path.join(widgetDir, file));
      }

      // Create Assets.xcassets with forma_logo
      const assetsDir = path.join(widgetDir, 'Assets.xcassets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(assetsDir, 'Contents.json'),
        JSON.stringify({ info: { version: 1, author: 'xcode' } }, null, 2)
      );

      // Create forma_logo imageset
      const logoImagesetDir = path.join(assetsDir, 'forma_logo.imageset');
      if (!fs.existsSync(logoImagesetDir)) {
        fs.mkdirSync(logoImagesetDir, { recursive: true });
      }

      // Copy the logo from project assets
      const logoSrc = path.join(
        config.modRequest.projectRoot,
        'src',
        'frontend',
        'assets',
        'forma_purple_logo.png'
      );
      if (fs.existsSync(logoSrc)) {
        fs.copyFileSync(logoSrc, path.join(logoImagesetDir, 'forma_logo.png'));
      }

      fs.writeFileSync(
        path.join(logoImagesetDir, 'Contents.json'),
        JSON.stringify(
          {
            images: [
              { filename: 'forma_logo.png', idiom: 'universal', scale: '1x' },
              { idiom: 'universal', scale: '2x' },
              { idiom: 'universal', scale: '3x' },
            ],
            info: { version: 1, author: 'xcode' },
          },
          null,
          2
        )
      );

      // Create widget entitlements
      const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>`;
      fs.writeFileSync(
        path.join(widgetDir, `${WIDGET_TARGET_NAME}.entitlements`),
        entitlements
      );

      return config;
    },
  ]);

  // Step 3: Add widget extension target to Xcode project
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const bundleId = config.ios?.bundleIdentifier ?? 'com.forma.app';
    const widgetBundleId = bundleId + WIDGET_BUNDLE_ID_SUFFIX;

    // Check if target already exists
    const existingTarget = xcodeProject.pbxTargetByName(WIDGET_TARGET_NAME);
    if (existingTarget) {
      return config;
    }

    const targetUuid = xcodeProject.generateUuid();
    const groupName = WIDGET_TARGET_NAME;

    // Add the widget extension target
    const target = xcodeProject.addTarget(
      WIDGET_TARGET_NAME,
      'app_extension',
      groupName,
      widgetBundleId
    );

    // Add source files to the target
    const widgetGroupKey = xcodeProject.pbxCreateGroup(groupName, `"${groupName}"`);

    // Add the group to the main project group
    const mainGroupId = xcodeProject.getFirstProject().firstProject.mainGroup;
    xcodeProject.addToPbxGroup(widgetGroupKey, mainGroupId);

    const swiftFiles = [
      'WorkoutAttributes.swift',
      'WorkoutLiveActivity.swift',
      'FormaWidgetsBundle.swift',
    ];

    for (const fileName of swiftFiles) {
      xcodeProject.addSourceFile(
        `${groupName}/${fileName}`,
        { target: target.uuid },
        widgetGroupKey
      );
    }

    // Add Info.plist as a resource reference (not compiled)
    xcodeProject.addFile(
      `${groupName}/Info.plist`,
      widgetGroupKey,
      {}
    );

    // Add Assets.xcassets
    xcodeProject.addResourceFile(
      `${groupName}/Assets.xcassets`,
      { target: target.uuid },
      widgetGroupKey
    );

    // Configure build settings for the widget target
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const config_entry = configurations[key];
      if (
        typeof config_entry === 'object' &&
        config_entry.buildSettings &&
        config_entry.baseConfigurationReference === undefined
      ) {
        // Check if this belongs to our target by looking at product name
        const productName = config_entry.buildSettings.PRODUCT_NAME;
        if (
          productName === `"${WIDGET_TARGET_NAME}"` ||
          productName === WIDGET_TARGET_NAME
        ) {
          Object.assign(config_entry.buildSettings, {
            SWIFT_VERSION: '5.0',
            IPHONEOS_DEPLOYMENT_TARGET: '16.2',
            PRODUCT_BUNDLE_IDENTIFIER: `"${widgetBundleId}"`,
            CODE_SIGN_ENTITLEMENTS: `"${WIDGET_TARGET_NAME}/${WIDGET_TARGET_NAME}.entitlements"`,
            INFOPLIST_FILE: `"${WIDGET_TARGET_NAME}/Info.plist"`,
            TARGETED_DEVICE_FAMILY: '"1,2"',
            ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: '"AccentColor"',
            ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME: '"WidgetBackground"',
            GENERATE_INFOPLIST_FILE: 'YES',
            CURRENT_PROJECT_VERSION: '1',
            MARKETING_VERSION: '1.0',
            SWIFT_EMIT_LOC_STRINGS: 'YES',
            LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
          });
        }
      }
    }

    return config;
  });

  return config;
}

module.exports = withLiveActivity;
