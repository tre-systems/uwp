// Soft loading veil for renderer init and other chart-blocking work.
interface LoadingOverlayProps {
  label?: string
}

export function LoadingOverlay({ label = 'Compiling renderer...' }: LoadingOverlayProps) {
  return (
    <div class="loading-overlay" role="status" aria-live="polite">
      <div class="loading-orbit" aria-hidden="true">
        <span class="loading-star" />
        <span class="loading-planet" />
      </div>
      <p class="loading-label">{label}</p>
    </div>
  )
}
