import { effect } from '@preact/signals'
import {
  setSubsectorOverrides,
  subsectorOverrides,
} from '.'
import type { Bases, SubsectorHexOverride, SubsectorOverrides, TravelZone } from '../domain/subsector'

const STORAGE_KEY = 'uwp.subsectorOverrides.v1'
const TRAVEL_ZONES: readonly TravelZone[] = ['Green', 'Amber', 'Red']

function safeRead(): SubsectorOverrides | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: SubsectorOverrides = {}
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeOverride(value)
      if (normalized) out[key] = normalized
    }
    return out
  } catch {
    return null
  }
}

function safeWrite(overrides: SubsectorOverrides): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Best-effort campaign-local persistence.
  }
}

function normalizeOverride(value: unknown): SubsectorHexOverride | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out: SubsectorHexOverride = {}
  if (typeof record.system_seed === 'number' && Number.isFinite(record.system_seed)) {
    out.system_seed = record.system_seed >>> 0
  }
  if (typeof record.travel_zone === 'string' && TRAVEL_ZONES.includes(record.travel_zone as TravelZone)) {
    out.travel_zone = record.travel_zone as TravelZone
  }
  if (typeof record.allegiance === 'string' && record.allegiance.trim()) {
    out.allegiance = record.allegiance.slice(0, 8)
  }
  const bases = normalizeBases(record.bases)
  if (bases) out.bases = bases
  return Object.keys(out).length > 0 ? out : null
}

function normalizeBases(value: unknown): Bases | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    naval: record.naval === true,
    scout: record.scout === true,
    research: record.research === true,
    Aid: record.Aid === true,
  }
}

export function loadPersistedSubsectorOverrides(): void {
  const persisted = safeRead()
  if (persisted) setSubsectorOverrides(persisted)
}

export function installSubsectorOverridePersistence(): void {
  effect(() => {
    safeWrite(subsectorOverrides.value)
  })
}
