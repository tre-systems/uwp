// Soft loading veil shown while the WASM module compiles and the GPU
// pipeline initialises. The canvas is opaque-black at that point and the
// user has no visual feedback otherwise, so we drop a single line of copy
// plus a slow pulse over the void.
export function LoadingOverlay() {
  return (
    <div class="loading-overlay" role="status" aria-live="polite">
      <div class="loading-orbit" aria-hidden="true">
        <span class="loading-star" />
        <span class="loading-planet" />
      </div>
      <p class="loading-label">Compiling renderer...</p>
    </div>
  )
}
