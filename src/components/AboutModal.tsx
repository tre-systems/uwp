import { useEffect, useRef } from 'preact/hooks'
import { BUILD_ID } from '../buildId'
import { useFocusTrap } from './useFocusTrap'

// Small about / credits modal, opened from the panel footer. Mirrors the
// glossary modal's shape so the two feel related without sharing code.

interface AboutModalProps {
  open: boolean
  onClose: () => void
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(modalRef, open)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      class="glossary-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      onClick={onClose}
    >
      <div class="glossary-modal about-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <header class="glossary-header">
          <h2 id="about-title">About UWP</h2>
          <button
            ref={closeRef}
            class="glossary-close"
            onClick={onClose}
            aria-label="Close about"
          >
            ✕
          </button>
        </header>
        <div class="glossary-body">
          <p class="about-lede">
            UWP is a procedural star-system generator for original 2d6
            science-fiction worlds. Worlds and solar systems are simulated in
            Rust and rendered on the GPU via WebGPU.
          </p>
          <dl class="glossary-list">
            <div class="glossary-entry">
              <dt>Engine</dt>
              <dd>
                Rust compiled to WebAssembly drives a wgpu-based renderer with WGSL
                shaders for planet surface, atmosphere, background, and system view.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Shell</dt>
              <dd>
                Preact + Vite for the UI. Cloudflare Workers serves the static bundle
                from <code>uwp.tre.systems</code>.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Rules reference</dt>
              <dd>
                World profile, trade codes, and starport classes follow the
                Cepheus Engine SRD. See the
                {' '}<a href="https://www.orffenspace.com/cepheus-srd/" target="_blank" rel="noreferrer">
                  Cepheus SRD
                </a>{' '}for the underlying tables.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Legal</dt>
              <dd>
                UWP is an independent tool for original worlds. It is not
                affiliated with legacy 2d6, third-party publishers, ultra-tech
                Enterprises, Cepheus Engine, Samardan Press, or Jason Kemp.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Source</dt>
              <dd>
                Open source on{' '}
                <a href="https://github.com/tre-systems/uwp" target="_blank" rel="noreferrer">
                  GitHub
                </a>. Issues and pull requests welcome.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Keyboard</dt>
              <dd>
                <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd> jump
                to Subsector / System / Main World / Surface.{' '}
                <kbd>Esc</kbd> pops back up one view.{' '}
                <kbd>Enter</kbd> or <kbd>Space</kbd> opens the focused hex
                in the subsector or surface grid.
              </dd>
            </div>
            <div class="glossary-entry">
              <dt>Build</dt>
              <dd><code>{BUILD_ID}</code></dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
