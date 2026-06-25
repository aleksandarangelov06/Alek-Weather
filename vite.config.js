import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'Alek Weather',
        short_name: 'Alek Weather',
        description: 'Real-time weather forecasts',
        theme_color: '#f0f2f5',
        background_color: '#f0f2f5',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather-api',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/geocoding-api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'geo-api',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.rainviewer\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'radar-frames',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 10 },
            },
          },
          {
            urlPattern: /^https:\/\/tilecache\.rainviewer\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'radar-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/air-quality-api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aqi-api',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
})
