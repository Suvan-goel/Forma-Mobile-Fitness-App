#!/usr/bin/env node
/**
 * Fixes iOS jsEngine in Podfile.properties.json from "hermes" to "jsc".
 *
 * expo-build-properties declares jsEngine: "jsc" in app.json but expo prebuild
 * writes "hermes" to Podfile.properties.json regardless. This script patches it.
 *
 * Why JSC on iOS: RN 0.79.x has a jsinspector-modern bug where LOG(FATAL) fires
 * on WebSocket reconnection failure, causing abort() in Hermes debug builds.
 *
 * Usage: node scripts/fix-ios-jsc.js (run after npx expo prebuild)
 */
const fs = require('fs');
const path = require('path');

const propsPath = path.join(__dirname, '..', 'ios', 'Podfile.properties.json');

if (!fs.existsSync(propsPath)) {
  console.log('[fix-ios-jsc] ios/Podfile.properties.json not found, skipping.');
  process.exit(0);
}

const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));

if (props['expo.jsEngine'] === 'jsc') {
  console.log('[fix-ios-jsc] Already set to jsc, nothing to do.');
  process.exit(0);
}

props['expo.jsEngine'] = 'jsc';
fs.writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');
console.log('[fix-ios-jsc] Fixed expo.jsEngine: "hermes" -> "jsc"');
