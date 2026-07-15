import { defineConfig } from '@vite-pwa/assets-generator/config'

const brandResize = {
  fit: 'contain' as const,
  position: 'centre',
  background: '#052319'
}

export default defineConfig({
  // This source is already flattened on the brand color so every platform,
  // including launchers that ignore transparency, renders the same canvas.
  images: ['public/brand/pwa-source.png'],
  manifestIconsEntry: false,
  preset: {
    transparent: {
      sizes: [192, 512],
      padding: 0,
      resizeOptions: brandResize
    },
    maskable: {
      sizes: [512],
      padding: 0,
      resizeOptions: brandResize
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: brandResize
    },
    assetName(type, size) {
      if (type === 'maskable') return `icon-maskable-${size.width}.png`
      if (type === 'apple') return 'apple-touch-icon.png'
      return `icon-${size.width}.png`
    }
  }
})
