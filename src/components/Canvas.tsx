import { useEffect, useRef } from 'preact/hooks'
import { RendererClient } from '../rendererClient'

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const client = new RendererClient(ref.current!)
    void client.start()
    return () => client.dispose()
  }, [])

  return (
    <canvas
      ref={ref}
      class="planet-canvas"
      role="img"
      aria-label="Interactive 3D rendering of the generated planet or solar system. Drag to orbit, scroll to zoom."
      tabIndex={0}
    />
  )
}
