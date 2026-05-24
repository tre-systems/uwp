// Build identifier injected at compile time by Vite (see vite.config.ts).
//
// Exposed as `window.__UWP_BUILD_ID` and logged on app startup so post-deploy
// verification — manual hard-refresh checks and automated e2e probes — can
// confirm which build is actually being served from production without
// having to inspect HTTP headers or hashed bundle filenames.
declare const __UWP_BUILD_ID__: string

declare global {
  interface Window {
    __UWP_BUILD_ID?: string
  }
}

export const BUILD_ID: string = __UWP_BUILD_ID__

export function publishBuildId(): void {
  if (typeof window !== 'undefined') {
    window.__UWP_BUILD_ID = BUILD_ID
  }
  // eslint-disable-next-line no-console
  console.info(`UWP build ${BUILD_ID}`)
}

/// Wire the service worker's update flow to reload the page so a returning
/// user never sits on a stale build.
///
/// VitePWA's `autoUpdate` register type installs a new service worker in the
/// background but doesn't trigger any reload of the running page. The new SW
/// activates and (via `clientsClaim()`) takes over the tab — but the JS
/// already on the page came from the *old* precached `index.html` because
/// the SW's NavigationRoute handler bypasses the network. Without this
/// listener, the user stays on the old build until they manually refresh.
///
/// `controllerchange` fires exactly when the new SW takes control of the
/// tab. We use a one-shot guard so we don't reload multiple times if the
/// browser dispatches the event more than once (some implementations do).
export function installServiceWorkerAutoReload(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}
