import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper (README §5). The same `dist/` build runs inside the iOS / Android shell.
// The native projects (ios/, android/) are generated in the cloud by .github/workflows/native.yml
// and patched by scripts/native/prepare.mjs — nothing here needs a Mac or Xcode.
//
// APP_ID must be a bundle id you own (register it in your Apple Developer account, with
// HealthKit enabled). Set it as a GitHub repository variable; the default is only a placeholder.
const config: CapacitorConfig = {
  appId: process.env.APP_ID || 'com.example.fitnessos',
  appName: 'Fitness OS',
  webDir: 'dist',
  backgroundColor: '#0b0d10',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { iconColor: '#c6f432' },
  },
};

export default config;
