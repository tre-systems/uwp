import type { RefObject } from 'preact'
import { useEffect } from 'preact/hooks'

// Keyboard users opening a modal expect Tab to cycle inside the dialog,
// not to fall back into the panel behind. This hook intercepts Tab while
// the modal is open and wraps focus across the dialog's tabbable nodes.
// Active only when `enabled` is true so it's safe to call unconditionally
// from a component that toggles the dialog open/closed.

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const nodes = container.querySelectorAll(FOCUSABLE)
      const focusable: HTMLElement[] = []
      nodes.forEach((node) => {
        const el = node as HTMLElement
        if (!el.hasAttribute('inert') && el.offsetParent !== null) focusable.push(el)
      })
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [containerRef, enabled])
}
