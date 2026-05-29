import { effect } from '@preact/signals'
import { currentSubsector, currentSystem, resolvedDetailTarget, selectedHex, subsectorSeed, systemSeed, uwp, uwpToCode, viewMode } from './index'
import { resolveHexName, systemName } from '../domain/names'
import { formatBodyViewLabel } from '../navigation/bodyView'
import { isMainWorldTarget } from '../systemVisualMapping'

// Mirror the current chart selection into document.title so a user with
// several UWP tabs open can tell them apart at a glance. The base name
// is kept as the suffix so the brand is still recognisable.

const BASE_TITLE = 'UWP - Cepheus star-system generator'

function compose(): string {
  const mode = viewMode.value
  const sub = currentSubsector.value
  const sel = selectedHex.value
  // A selected hex and its system share one canonical name (see resolveHexName),
  // so the tab title matches the map / breadcrumb / panel. Fall back to the
  // system seed only for a standalone system opened directly by seed.
  const sysName = sub && sel ? resolveHexName(sub, sel) : systemName(systemSeed.value)
  const sectorName = `${systemName(subsectorSeed.value)} Sector`
  if (mode === 'subsector') return `${sectorName} — UWP`
  if (mode === 'system') return `${sysName} system — UWP`
  if (mode === 'surface') {
    const body = formatBodyViewLabel(currentSystem.value, resolvedDetailTarget(currentSystem.value))
    return `${body} surface — UWP`
  }
  // Detail view: UWP digits only describe the main world; other bodies omit them.
  const sys = currentSystem.value
  const target = resolvedDetailTarget(sys)
  const body = formatBodyViewLabel(sys, target)
  if (!target || isMainWorldTarget(sys, target)) {
    return `${body} (${uwpToCode(uwp.value)}) — UWP`
  }
  return `${body} — UWP`
}

export function installDocumentTitle(): void {
  if (typeof document === 'undefined') return
  effect(() => {
    document.title = compose()
  })
}

export { BASE_TITLE }
