import type { SubsectorOverrides, SubsectorRouteOverrides } from '../domain/subsector'

/** Compact base64url JSON for referee overrides in share links. */
export interface SubsectorOverridesPayload {
  h: SubsectorOverrides
  r: SubsectorRouteOverrides
}

export function filterOverridesForSeed(
  seed: number,
  hex: SubsectorOverrides,
  routes: SubsectorRouteOverrides,
): SubsectorOverridesPayload {
  const prefix = `${seed >>> 0}:`
  const h: SubsectorOverrides = {}
  const r: SubsectorRouteOverrides = {}
  for (const [key, value] of Object.entries(hex)) {
    if (key.startsWith(prefix)) h[key] = value
  }
  for (const [key, value] of Object.entries(routes)) {
    if (key.startsWith(prefix)) r[key] = value
  }
  return { h, r }
}

export function encodeOverridesPayload(payload: SubsectorOverridesPayload): string | null {
  if (Object.keys(payload.h).length === 0 && Object.keys(payload.r).length === 0) return null
  const json = JSON.stringify(payload)
  if (json.length > 1800) return null
  return base64UrlEncode(json)
}

export function decodeOverridesPayload(raw: string): SubsectorOverridesPayload | null {
  try {
    const json = base64UrlDecode(raw)
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const h = record.h
    const r = record.r
    if (!h || typeof h !== 'object' || Array.isArray(h)) return null
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null
    return { h: h as SubsectorOverrides, r: r as SubsectorRouteOverrides }
  } catch {
    return null
  }
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  const binary = atob(padded + '='.repeat(pad))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
