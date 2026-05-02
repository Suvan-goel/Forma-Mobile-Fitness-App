#!/usr/bin/env node
/**
 * Post-prebuild iOS patches.
 *
 * 1. jsEngine: forces Podfile.properties.json from "hermes" to "jsc"
 *    (RN 0.79.x jsinspector-modern bug — LOG(FATAL) on WS reconnect aborts under Hermes).
 * 2. fmt consteval: patches Podfile post_install to disable FMT_USE_CONSTEVAL,
 *    avoiding Xcode 15.3+ "Call to consteval function ... is not a constant
 *    expression" errors in Pods/fmt/include/fmt/format-inl.h.
 *
 * Idempotent — safe to run repeatedly.
 * Usage: node scripts/fix-ios-jsc.js (run after npx expo prebuild)
 */
const fs = require('fs');
const path = require('path');

const iosDir = path.join(__dirname, '..', 'ios');
const propsPath = path.join(iosDir, 'Podfile.properties.json');
const podfilePath = path.join(iosDir, 'Podfile');

// ── 1. jsEngine patch ──────────────────────────────────────────────────────
if (!fs.existsSync(propsPath)) {
  console.log('[fix-ios-jsc] ios/Podfile.properties.json not found, skipping.');
} else {
  const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
  if (props['expo.jsEngine'] === 'jsc') {
    console.log('[fix-ios-jsc] jsEngine already jsc.');
  } else {
    props['expo.jsEngine'] = 'jsc';
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');
    console.log('[fix-ios-jsc] Fixed expo.jsEngine: "hermes" -> "jsc"');
  }
}

// ── 2. fmt consteval patch (Xcode 15.3+) ───────────────────────────────────
//
// fmt 11.0.2's base.h hardcodes `#define FMT_USE_CONSTEVAL` unconditionally
// (no #ifndef guard), so the build-flag approach (-DFMT_USE_CONSTEVAL=0) is
// silently overwritten. The only reliable fix is to patch base.h directly,
// converting `#define FMT_CONSTEVAL consteval` -> `#define FMT_CONSTEVAL`.
//
// Two attack points:
//  (a) Podfile post_install hook — patches base.h on every `pod install`
//      so a fresh Pods/ directory is fixed automatically.
//  (b) Direct patch of the existing Pods/fmt/include/fmt/base.h — fixes the
//      currently-checked-out Pods/ without re-running pod install.
//
// Both are idempotent.

const FMT_MARKER = '[forma:fmt-consteval-fix]';
const FMT_BASE_REL = 'Pods/fmt/include/fmt/base.h';
const FMT_OLD = '#  define FMT_CONSTEVAL consteval';
const FMT_NEW = '#  define FMT_CONSTEVAL /* consteval — patched out by scripts/fix-ios-jsc.js for Xcode 15.3+ */';

const PODFILE_PATCH = `
    # ${FMT_MARKER} fmt 11.x ships consteval that breaks under Xcode 15.3+.
    # base.h hardcodes the define, so build flags don't help — patch the header.
    # CocoaPods marks Pod source files read-only after install, so we must
    # chmod 0644 before File.write or the patch silently fails with EACCES.
    fmt_base = File.expand_path('${FMT_BASE_REL}', __dir__)
    if File.exist?(fmt_base)
      contents = File.read(fmt_base)
      patched = contents.gsub('${FMT_OLD}', '${FMT_NEW}')
      if patched != contents
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
        Pod::UI.puts "[forma] Patched fmt/base.h to disable consteval"
      end
    end
`;

// (a) Inject Podfile post_install hook
if (!fs.existsSync(podfilePath)) {
  console.log('[fix-ios-jsc] ios/Podfile not found, skipping Podfile fmt patch.');
} else {
  let podfile = fs.readFileSync(podfilePath, 'utf8');
  if (podfile.includes(FMT_MARKER)) {
    console.log('[fix-ios-jsc] Podfile fmt patch already present.');
  } else {
    const closeMatch = podfile.match(/\n {2}end\nend\s*$/);
    if (!closeMatch) {
      console.error('[fix-ios-jsc] could not locate post_install end block; skipping Podfile patch.');
    } else {
      podfile = podfile.slice(0, closeMatch.index) + PODFILE_PATCH + podfile.slice(closeMatch.index);
      fs.writeFileSync(podfilePath, podfile);
      console.log('[fix-ios-jsc] Injected fmt header-patch hook into Podfile post_install.');
    }
  }
}

// (b) Patch the currently-checked-out base.h directly (if Pods/ exists).
// CocoaPods marks Pod source files read-only after install, so chmod 0644
// before writing or the write fails with EACCES.
const fmtBasePath = path.join(iosDir, FMT_BASE_REL);
if (fs.existsSync(fmtBasePath)) {
  const original = fs.readFileSync(fmtBasePath, 'utf8');
  if (original.includes(FMT_OLD)) {
    fs.chmodSync(fmtBasePath, 0o644);
    fs.writeFileSync(fmtBasePath, original.replace(FMT_OLD, FMT_NEW));
    console.log('[fix-ios-jsc] Patched Pods/fmt/include/fmt/base.h directly.');
  } else if (original.includes(FMT_NEW)) {
    console.log('[fix-ios-jsc] base.h already patched.');
  } else {
    console.warn('[fix-ios-jsc] base.h does not match expected fmt 11.x pattern; please inspect manually.');
  }
} else {
  console.log('[fix-ios-jsc] Pods/fmt not yet installed; will be patched on next `pod install`.');
}
