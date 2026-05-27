import { signal } from '@preact/signals'

/** Non-renderer work that can block the main thread (subsector gen, surface map, system load). */
export const chartWorkMessage = signal<string | null>(null)

let chartWorkDepth = 0

export function pushChartWork(message: string): void {
  chartWorkDepth += 1
  chartWorkMessage.value = message
}

export function popChartWork(): void {
  chartWorkDepth = Math.max(0, chartWorkDepth - 1)
  if (chartWorkDepth === 0) {
    chartWorkMessage.value = null
  }
}

/** Paint one frame so a busy overlay can appear before synchronous WASM work. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 0)
    schedule(() => {
      schedule(() => resolve())
    })
  })
}

export async function withChartWork<T>(message: string, fn: () => T | Promise<T>): Promise<T> {
  pushChartWork(message)
  await yieldToPaint()
  try {
    return await fn()
  } finally {
    popChartWork()
  }
}

/** Reset busy state (unit tests). */
export function resetChartWorkForTests(): void {
  chartWorkDepth = 0
  chartWorkMessage.value = null
}
