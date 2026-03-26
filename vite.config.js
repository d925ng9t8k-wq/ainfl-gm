import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  build: {
    // Use content hash in filenames so browser loads new files when content changes
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Split allRosters into its own chunk so it's cached independently.
        // This is the ~672KB roster dataset — it changes infrequently, so keeping
        // it separate from app code means users don't re-download it on every deploy.
        manualChunks(id) {
          if (id.includes('src/data/allRosters')) {
            return 'data-rosters';
          }
          if (id.includes('src/data/')) {
            return 'data-static';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      devOptions: { enabled: false },
      registerType: 'autoUpdate',
      includeAssets: ['bengals-icon.svg'],
      manifest: {
        name: 'AiNFL GM',
        short_name: 'AiNFLGM',
        description: 'NFL offseason simulator for the Cincinnati Bengals',
        theme_color: '#FB4F14',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/bengals-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
