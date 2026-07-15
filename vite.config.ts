import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'brand/logo.png',
        'brand/icon-192.png',
        'brand/icon-512.png',
        'brand/icon-maskable-512.png',
        'brand/apple-touch-icon.png'
      ],
      manifest: {
        name: 'Tienda Castalia',
        short_name: 'Castalia',
        description: 'Consumos, cuentas compartidas e inventario con compras offline seguras.',
        theme_color: '#052319',
        background_color: '#052319',
        display: 'standalone',
        lang: 'es',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/brand/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/brand/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/brand/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'catalog-images',
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
