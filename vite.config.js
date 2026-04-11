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
          if (id.includes('src/data/nba/nbaRosters')) {
            return 'data-nba-rosters';
          }
          if (id.includes('src/data/nba/')) {
            return 'data-nba-static';
          }
          // Keep MLB static data isolated from the NFL-focused data-static
          // chunk. Otherwise MLB data (only needed under /mlb) would get
          // pulled into the initial-paint bundle for every NFL visitor.
          if (id.includes('src/data/mlb/mlbRosters')) {
            return 'data-mlb-rosters';
          }
          if (id.includes('src/data/mlb/')) {
            return 'data-mlb-static';
          }
          if (id.includes('src/data/')) {
            return 'data-static';
          }
          // react-router ships ~20KB and is reused across every route —
          // give it its own chunk so it stays cached across deploys.
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
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
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          // Google Fonts stylesheet — rarely changes
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts files (woff2 etc.)
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Hashed JS/CSS build assets — content-hashed, safe to cache for a year
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/.+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'hashed-assets-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Same-origin images (root-level like nfl-hero.webp, robot-small.jpg, plus /assets)
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\.(?:png|jpe?g|svg|webp|avif|gif|ico)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Cross-origin images (CDNs, avatars)
          {
            urlPattern: /\.(?:png|jpe?g|svg|webp|avif|gif|ico)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cross-origin-images-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // AdSense / Google Analytics scripts — served short-TTL by Google
          {
            urlPattern: /^https:\/\/(?:pagead2\.googlesyndication\.com|www\.google-analytics\.com|www\.googletagmanager\.com)\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-ads-analytics-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // HeyGen embed / third-party CSS
          {
            urlPattern: /^https:\/\/.*\.heygen\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'heygen-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
