// Patches the Capacitor-generated native projects (README §5). Runs in the cloud build
// (.github/workflows/native.yml) right after `npx cap add ios|android`, so the repo never holds
// an Xcode project and nobody needs a Mac. Safe to run more than once.
//
//   node scripts/native/prepare.mjs            patches ios/ and/or android/ if they exist
//
// Env: BUILD_NUMBER (defaults to 1) becomes the iOS build / Android versionCode;
//      the marketing version comes from package.json.
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const res = join(root, 'resources');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const build = String(Number(process.env.BUILD_NUMBER) || 1);

const HEALTH_READ_WHY =
  'Fitness OS reads your weight and sleep so your progress, trends and weekly review stay up to date without typing them in. Nothing is shared.';
// Only the Health Connect permissions the app uses; the plugin declares many more.
const KEEP_HEALTH = new Set(['READ_WEIGHT', 'READ_SLEEP']);

function edit(file, fn) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
  console.log(after !== before ? `patched ${file.slice(root.length + 1)}` : `unchanged ${file.slice(root.length + 1)}`);
}

// ── iOS ──────────────────────────────────────────────────────────────────
export function patchInfoPlist(xml) {
  const add = (s, key, value) => (s.includes(`<key>${key}</key>`) ? s : s.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${value}\n</dict>\n</plist>\n`));
  let s = add(xml, 'NSHealthShareUsageDescription', `<string>${HEALTH_READ_WHY}</string>`);
  s = add(s, 'ITSAppUsesNonExemptEncryption', '<false/>'); // HTTPS only → no export-compliance question
  // Portrait only on iPhone, like the PWA manifest.
  s = s.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/, '$1\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t$2');
  return s;
}

export function patchPbxproj(text, { marketing, buildNumber }) {
  return text
    .split(/(buildSettings = \{[\s\S]*?\n\t\t\t\};)/)
    .map((block) => {
      if (!block.startsWith('buildSettings') || !block.includes('PRODUCT_BUNDLE_IDENTIFIER')) return block;
      let b = block;
      if (!b.includes('CODE_SIGN_ENTITLEMENTS')) b = b.replace(/(\n(\t+)CODE_SIGN_STYLE = [^;]+;)/, '\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1');
      b = b.replace(/MARKETING_VERSION = [^;]+;/, `MARKETING_VERSION = ${marketing};`);
      b = b.replace(/CURRENT_PROJECT_VERSION = [^;]+;/, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
      b = b.replace(/TARGETED_DEVICE_FAMILY = [^;]+;/, 'TARGETED_DEVICE_FAMILY = 1;'); // iPhone app
      return b;
    })
    .join('');
}

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.healthkit</key>
\t<true/>
\t<key>com.apple.developer.healthkit.access</key>
\t<array/>
</dict>
</plist>
`;

function ios() {
  const app = join(root, 'ios/App/App');
  if (!existsSync(app)) return;
  edit(join(app, 'Info.plist'), patchInfoPlist);
  writeFileSync(join(app, 'App.entitlements'), ENTITLEMENTS);
  console.log('wrote ios/App/App/App.entitlements');
  edit(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), (t) => patchPbxproj(t, { marketing: version, buildNumber: build }));
  const icons = join(app, 'Assets.xcassets/AppIcon.appiconset');
  for (const f of readdirSync(icons).filter((f) => f.endsWith('.png'))) copyFileSync(join(res, 'ios/AppIcon-1024.png'), join(icons, f));
  const splash = join(app, 'Assets.xcassets/Splash.imageset');
  for (const f of readdirSync(splash).filter((f) => f.endsWith('.png'))) copyFileSync(join(res, 'ios/splash-2732.png'), join(splash, f));
  console.log('copied iOS icon + splash');
}

// ── Android ──────────────────────────────────────────────────────────────
export function patchManifest(xml, pluginPermissions) {
  let s = xml;
  if (!s.includes('xmlns:tools=')) s = s.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android"', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"');
  if (!s.includes('android:screenOrientation')) s = s.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"');
  const extra = [];
  for (const p of pluginPermissions) {
    const short = p.replace('android.permission.health.', '');
    if (p.startsWith('android.permission.health.') && !KEEP_HEALTH.has(short)) extra.push(`<uses-permission android:name="${p}" tools:node="remove" />`);
  }
  // Reminders are fine a few minutes late; exact alarms need a special Play policy declaration.
  extra.push('<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />');
  // Read more than the last 30 days of Health Connect history (weight trend, sleep averages).
  extra.push('<uses-permission android:name="android.permission.health.READ_HEALTH_DATA_HISTORY" />');
  const missing = extra.filter((line) => !s.includes(line.match(/android:name="([^"]+)"/)[0]));
  if (missing.length) s = s.replace(/\n<\/manifest>\s*$/, `\n    <!-- Fitness OS (scripts/native/prepare.mjs) -->\n${missing.map((l) => `    ${l}`).join('\n')}\n</manifest>\n`);
  return s;
}

export function patchStyles(xml) {
  if (xml.includes('windowSplashScreenBackground')) return xml;
  return xml.replace(
    /<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">[\s\S]*?<\/style>/,
    `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/fos_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:background">@color/fos_background</item>
    </style>`,
  );
}

function android() {
  const main = join(root, 'android/app/src/main');
  if (!existsSync(main)) return;
  const pluginManifest = join(root, 'node_modules/@capgo/capacitor-health/android/src/main/AndroidManifest.xml');
  const perms = existsSync(pluginManifest) ? [...readFileSync(pluginManifest, 'utf8').matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]) : [];
  edit(join(main, 'AndroidManifest.xml'), (x) => patchManifest(x, perms));
  edit(join(root, 'android/variables.gradle'), (t) => t.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26')); // Health Connect
  edit(join(root, 'android/app/build.gradle'), (t) => t.replace(/versionCode \d+/, `versionCode ${build}`).replace(/versionName "[^"]*"/, `versionName "${version}"`));
  edit(join(main, 'res/values/styles.xml'), patchStyles);
  writeFileSync(join(main, 'res/values/fos_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="fos_background">#0B0D10</color>\n</resources>\n');
  edit(join(main, 'res/values/ic_launcher_background.xml'), (t) => t.replace(/#[0-9A-Fa-f]{6}/, '#0B0D10'));
  for (const d of readdirSync(join(res, 'android'))) {
    for (const f of readdirSync(join(res, 'android', d))) copyFileSync(join(res, 'android', d, f), join(main, 'res', d, f));
  }
  // The splash is now the theme colour + icon, so the template's bitmaps go.
  for (const d of readdirSync(join(main, 'res')).filter((d) => d.startsWith('drawable'))) {
    const f = join(main, 'res', d, 'splash.png');
    if (existsSync(f)) rmSync(f);
  }
  console.log('copied Android icons, splash uses the theme');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ios();
  android();
}
