import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

// The PNG icons and favicon.ico in public/, drawn from pwa-icon.svg. Run with
// `npm run generate-pwa-assets` after changing the icon; the output is
// committed, so a build doesn't depend on it. pwa-icon.svg is a full-bleed
// square (the sky runs to every edge), so none of the sizes is padded: the
// preset's white margin would frame it in a white border instead.
//
// The maskable icon is left out here and drawn from pwa-icon-maskable.svg by
// scripts/maskable-icon.mjs: padding the full-bleed art would leave a flat band
// around the sky, so that file scales the art down inside an unpadded sky.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    transparent: { ...preset.transparent, padding: 0 },
    maskable: { ...preset.maskable, sizes: [] },
    apple: { ...preset.apple, padding: 0 },
  },
  images: ['public/pwa-icon.svg'],
})
