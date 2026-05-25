import { effect } from '@preact/signals'
import { subsectorSeed, systemSeed, uwp, uwpToCode, viewMode } from './index'
import { systemName } from '../domain/names'

// Mirror the current chart selection into document.title so a user with
// several UWP tabs open can tell them apart at a glance. The base name
// is kept as the suffix so the brand is still recognisable.

const BASE_TITLE = 'UWP - Cepheus star-system generator'

function compose(): string {
  const mode = viewMode.value
  const sysName = systemName(systemSeed.value)
  const sectorName = `${systemName(subsectorSeed.value)} Sector`
  if (mode === 'subsector') return `${sectorName} — UWP`
  if (mode === 'system') return `${sysName} system — UWP`
  if (mode === 'surface') return `${sysName} surface — UWP`
  // detail (main world): include the UWP code so each chart reads
  // distinctly even when two systems happen to share a name.
  return `${sysName} (${uwpToCode(uwp.value)}) — UWP`
}

export function installDocumentTitle(): void {
  if (typeof document === 'undefined') return
  effect(() => {
    document.title = compose()
  })
}

export { BASE_TITLE }
