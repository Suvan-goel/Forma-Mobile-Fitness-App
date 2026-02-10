#!/usr/bin/env node
/**
 * Applies createFragment retry fix to @thinksys/react-native-mediapipe.
 * Fixes black camera on Android when ref is null on first mount.
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

const patched = `  useEffect(() => {
    if (!isAndroid) return;
    const tryCreate = (attempt = 0) => {
      const viewId = findNodeHandle(ref.current);
      if (viewId != null) {
        createFragment(viewId);
      } else if (attempt < 12) {
        setTimeout(() => tryCreate(attempt + 1), 50);
      }
    };
    tryCreate(0);
  }, []);`;

const patchedWithDelay = `    setTimeout(() => tryCreate(0), 50);`;
const patchedImmediate = `    tryCreate(0);`;

if (content.includes(original) && !content.includes('tryCreate')) {
  content = content.replace(original, patched);
  fs.writeFileSync(filePath, content);
  console.log('Applied createFragment retry fix to react-native-mediapipe');
} else if (content.includes(patchedWithDelay)) {
  content = content.replace(patchedWithDelay, patchedImmediate);
  fs.writeFileSync(filePath, content);
  console.log('Updated createFragment fix: removed initial 50ms delay');
}
