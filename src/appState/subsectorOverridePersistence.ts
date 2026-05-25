import { effect } from '@preact/signals'
import {
  setSubsectorOverrides,
  setSubsectorRouteOverrides,
  subsectorRouteOverrides,
  subsectorOverrides,
} from '.'
import type {
  Bases,
  SubsectorHexOverride,
  SubsectorOverrides,
  SubsectorRouteOverride,
  SubsectorRouteOverrides,
  TravelZone,
} from '../domain/subsector'

const STORAGE_KEY = 'uwp.subsectorOverrides.v1'
const ROUTE_STORAGE_KEY = 'uwp.subsectorRouteOverrides.v1'
const TRAVEL_ZONES: readonly TravelZone[] = ['Green', 'Amber', 'Red']

function safeReadHexOverrides(): SubsectorOverrides | null {
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

function safeReadRouteOverrides(): SubsectorRouteOverrides | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(ROUTE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: SubsectorRouteOverrides = {}
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeRouteOverride(value)
      if (normalized) out[key] = normalized
    }
    return out
  } catch {
    return null
  }
}

function safeWrite(key: string, overrides: SubsectorOverrides | SubsectorRouteOverrides): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(overrides))
  } catch {
    // Best-effort campaign-local persistence.
  }
}

function normalizeRouteOverride(value: unknown): SubsectorRouteOverride | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out: SubsectorRouteOverride = {}
  if (typeof record.from_system_seed === 'number' && Number.isFinite(record.from_system_seed)) {
    out.from_system_seed = record.from_system_seed >>> 0
  }
  if (typeof record.to_system_seed === 'number' && Number.isFinite(record.to_system_seed)) {
    out.to_system_seed = record.to_system_seed >>> 0
  }
  if (typeof record.visible === 'boolean') out.visible = record.visible
  if (typeof record.communication === 'boolean') out.communication = record.communication
  if (typeof record.trade === 'boolean') out.trade = record.trade
  if (typeof record.trade_score === 'number' && Number.isFinite(record.trade_score)) {
    out.trade_score = Math.max(0, Math.min(9, Math.round(record.trade_score)))
  }
  return Object.keys(out).length > 0 ? out : null
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
  const hexOverrides = safeReadHexOverrides()
  if (hexOverrides) setSubsectorOverrides(hexOverrides)
  const routeOverrides = safeReadRouteOverrides()
  if (routeOverrides) setSubsectorRouteOverrides(routeOverrides)
}

export function installSubsectorOverridePersistence(): void {
  effect(() => {
    safeWrite(STORAGE_KEY, subsectorOverrides.value)
  })
  effect(() => {
    safeWrite(ROUTE_STORAGE_KEY, subsectorRouteOverrides.value)
  })
}
