import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE_PATH ?? '/'

// Defense-in-depth: restrict every resource type to the exact origins the app
// uses, so injected or compromised code can't call out anywhere else.
// Injected only on build — the dev server needs inline scripts and a
// websocket for HMR, which this policy would block.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // 'unsafe-inline' is required: React inline style props and Leaflet's
  // positioning both set style attributes.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  // mesonet.agron.iastate.edu serves the HRRR futurecast radar tiles.
  "img-src 'self' data: blob: https://tilecache.rainviewer.com https://*.basemaps.cartocdn.com https://cdn.jsdelivr.net https://mesonet.agron.iastate.edu",
  // api-bdc.io is BigDataCloud's canonical reverse-geocode host; api.bigdatacloud.net
  // 307-redirects to it, so both are allowed (the redirect target must be permitted too).
  // mesonet.agron.iastate.edu also provides the HRRR run metadata JSON (fetch).
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://air-quality-api.open-meteo.com https://api.weather.gov https://api.rainviewer.com https://api.bigdatacloud.net https://api-bdc.io https://mesonet.agron.iastate.edu",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const cspPlugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return {
      html,
      tags: [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      }],
    }
  },
}

export default defineConfig({
  base,
  plugins: [
    cspPlugin,
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
