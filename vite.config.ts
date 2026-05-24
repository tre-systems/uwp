/// <reference types="node" />
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Stable identifier of the running build. Used to make post-deploy
// verification trivial: the value is logged to the console on startup and
// exposed as `window.__UWP_BUILD_ID` so manual + automated tests can assert
// they are hitting the deploy they expect.
//
// Composed from the GitHub Actions commit SHA when running in CI, falling
// back to the local git short SHA, falling back to the build timestamp.
function resolveBuildId(): string {
  if (process.env.GITHUB_SHA) {
    return `${process.env.GITHUB_SHA.slice(0, 7)}-ci`
  }
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (sha) return sha
  } catch {
    // fall through to timestamp
  }
  return `dev-${Date.now()}`
}

const buildId = resolveBuildId()

export default defineConfig({
  define: {
    // Compile-time substitution; consumers reference `__UWP_BUILD_ID__`.
    __UWP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    preact(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'UWP',
        short_name: 'UWP',
        description: 'Procedural 3D planets driven by Cepheus/legacy 2d6 UWP codes, rendered with WebGPU.',
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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Make a new service worker take over immediately on activation
        // instead of waiting for every tab to close. Combined with the
        // Cache-Control headers in public/_headers, this means a returning
        // user picks up the new build on the next navigation rather than
        // serving stale shell from the precache.
        skipWaiting: true,
        clientsClaim: true,
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
