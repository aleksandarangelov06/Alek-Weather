// Renders public/maskable-icon-512x512.png from public/pwa-icon-maskable.svg
// (see pwa-assets.config.js for why it is drawn separately).
import sharp from 'sharp'

await sharp('public/pwa-icon-maskable.svg', { density: 144 })
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile('public/maskable-icon-512x512.png')
