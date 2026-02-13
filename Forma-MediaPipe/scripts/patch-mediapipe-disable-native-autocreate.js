#!/usr/bin/env node
/**
 * Disables native createFragmentAuto in TsMediapipeViewManager.
 * Fragment creation is handled by JS createFragment (with retry) instead.
 * This avoids race conditions between the two creation paths.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/@thinksys/react-native-mediapipe/android/src/main/java/com/tsmediapipe/TsMediapipeViewManager.java'
);

if (!fs.existsSync(filePath)) {
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

const blockToRemove = `    if (currentFragment == null && propWidth > 0 && propHeight > 0) {
      view.post(new Runnable() {
        @Override
        public void run() {
          if (view.getParent() != null) {
            createFragmentAuto(view);
          } else {
            Log.w("TsMediapipe", "View not yet attached to parent, retrying...");
            view.postDelayed(new Runnable() {
              @Override
              public void run() {
                createFragmentAuto(view);
              }
            }, 100);
          }
        }
      });
    }`;

const replacement = `    // Fragment creation handled by JS createFragment (with retry) - native createFragmentAuto disabled to avoid race
    // if (currentFragment == null && propWidth > 0 && propHeight > 0) { view.post(...createFragmentAuto...); }`;

if (content.includes(blockToRemove)) {
  content = content.replace(blockToRemove, replacement);
  fs.writeFileSync(filePath, content);
  console.log('Disabled native createFragmentAuto (JS createFragment handles it)');
} else if (content.includes('// Fragment creation handled by JS createFragment')) {
  // Already patched
} else {
  console.log('patch-mediapipe-disable-native-autocreate: no matching block found');
}
