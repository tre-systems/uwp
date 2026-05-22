import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    preact(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Planetto',
        short_name: 'Planetto',
        description: 'Procedural 3D planets, rendered with WebGPU.',
        theme_color: '#05070d',
        background_color: '#05070d',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
      }
    })
  ],
  build: {
    target: 'esnext',
    sourcemap: true
  },
  server: {
    fs: { allow: ['..'] }
  }
})
