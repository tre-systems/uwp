// Two distinct presentations:
//   `unsupported` - the browser/device doesn't expose WebGPU at all. The
//   user can't recover by retrying; we point them at supported browsers.
//   `error` - the GPU stack is present but something else failed (driver
//   crash, shader validation, etc). Surface the raw message under a "what
//   went wrong" disclosure so the user can paste it into a bug report.

interface ErrorOverlayProps {
  kind: 'unsupported' | 'error'
  detail?: string | null
}

export function ErrorOverlay({ kind, detail }: ErrorOverlayProps) {
  if (kind === 'unsupported') {
    return (
      <div class="error-overlay" role="alert">
        <div class="error-card">
          <h2>WebGPU is not available</h2>
          <p>
            UWP renders entirely on the GPU, so it needs a browser that exposes
            WebGPU.
          </p>
          <ul class="error-checklist">
            <li>Chrome or Edge 113+ on desktop or Android</li>
            <li>Safari 18+ on macOS or iOS</li>
            <li>
              Firefox: open <code>about:config</code> and set
              <code>dom.webgpu.enabled</code> to <code>true</code>
            </li>
          </ul>
          <p class="hint">
            If you're already in a supported browser, try updating your graphics
            driver - older drivers sometimes hide WebGPU from the page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div class="error-overlay" role="alert">
      <div class="error-card">
        <h2>The renderer crashed</h2>
        <p>
          The GPU pipeline failed to start. Refresh the page to retry, or copy
          the error below into a bug report.
        </p>
        {detail && (
          <details class="error-detail">
            <summary>What went wrong</summary>
            <pre>{detail}</pre>
          </details>
        )}
        <button class="error-reload" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}
