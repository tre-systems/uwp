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
