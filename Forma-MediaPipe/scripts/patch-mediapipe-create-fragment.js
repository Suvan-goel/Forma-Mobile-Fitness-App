#!/usr/bin/env node
/**
 * Applies createFragment retry fix to @thinksys/react-native-mediapipe.
 * JS creates the fragment with retry (native createFragmentAuto is disabled to avoid race).
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/@thinksys/react-native-mediapipe/src/index.tsx'
);

if (!fs.existsSync(filePath)) {
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

const original = `  useEffect(() => {
    const viewId = findNodeHandle(ref.current);
    if (isAndroid) {
      createFragment(viewId);
    }
  }, []);`;

const noopPatch = `  useEffect(() => {
    // Fragment creation is handled natively by onAfterUpdateTransaction -> createFragmentAuto.
    // Calling createFragment from JS races with the native path and can destroy a working fragment.
  }, []);`;

const retryPatch = `  useEffect(() => {
    if (!isAndroid) return;
    const tryCreate = (attempt = 0) => {
      const viewId = findNodeHandle(ref.current);
      if (viewId != null) {
        createFragment(viewId);
      } else if (attempt < 15) {
        setTimeout(() => tryCreate(attempt + 1), 50);
      }
    };
    tryCreate(0);
  }, []);`;

// Apply retry patch (native createFragmentAuto is now disabled, so no race)
if (content.includes(original) && !content.includes('tryCreate')) {
  content = content.replace(original, retryPatch);
  fs.writeFileSync(filePath, content);
  console.log('Applied createFragment retry fix to react-native-mediapipe');
} else if (content.includes('// Fragment creation is handled natively') || content.includes(noopPatch)) {
  const noopRegex = /  useEffect\(\(\) => \{\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\s*\n\s*\}, \[\]\);/m;
  if (noopRegex.test(content)) {
    content = content.replace(noopRegex, retryPatch);
    fs.writeFileSync(filePath, content);
    console.log('Restored createFragment retry (native auto-create disabled)');
  }
} else if (content.includes('tryCreate')) {
  // Already has retry - ensure native autocreate script runs
} else {
  console.log('createFragment patch: no matching pattern found');
}
