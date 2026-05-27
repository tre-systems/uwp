import { effect } from '@preact/signals'
import { currentSystem, subsectorSeed, systemSeed, uwp, uwpToCode, viewMode } from './index'
import { systemName } from '../domain/names'
import { formatBodyViewLabel, resolvedDetailTarget } from '../navigation/bodyView'

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
  if (mode === 'surface') {
    const body = formatBodyViewLabel(currentSystem.value, resolvedDetailTarget(currentSystem.value))
    return `${body} surface — UWP`
  }
  // Detail view: name the body being rendered, not always the system name.
  const body = formatBodyViewLabel(currentSystem.value, resolvedDetailTarget(currentSystem.value))
  return `${body} (${uwpToCode(uwp.value)}) — UWP`
}

export function installDocumentTitle(): void {
  if (typeof document === 'undefined') return
  effect(() => {
    document.title = compose()
  })
}

export { BASE_TITLE }
