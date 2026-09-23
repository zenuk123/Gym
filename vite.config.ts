/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          id: base,
          name: 'Fitness OS',
          short_name: 'Fitness OS',
          description: 'Your personal fitness operating system — training, nutrition and progress.',
          lang: 'en-GB',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0b0d10',
          theme_color: '#0b0d10',
          categories: ['health', 'fitness', 'lifestyle'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // App shell: every built asset is precached so the app opens with no signal.
          // (iOS reads splash images once at install time, so they aren't precached.)
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          globIgnores: ['splash/**'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          // First install takes control straight away (so the very first visit is already
          // offline-capable). Updates still wait for the user to tap "Update".
          clientsClaim: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'node',
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
