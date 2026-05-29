import type { Subsector } from './subsector/types'

// Deterministic, pronounceable system / hex name generator.
//
// Seed -> CV-CV-CV pattern from a small consonant + vowel inventory so
// every name is short, easy to say out loud, and unique enough across
// 4 billion seeds. Optionally appends a Greek-letter suffix for a small
// fraction of seeds to break the monotony of pure stems.
//
// The bigram lists were tuned to avoid name-sequences that read as
// English words; the inventory leans Cepheus flavour
// (lots of soft consonants, no `q`, no English plurals).

const CONSONANTS = [
  'b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z',
  'br', 'cr', 'dr', 'fr', 'gr', 'kr', 'tr', 'vr', 'bl', 'cl', 'gl', 'pl', 'sl', 'th', 'sh', 'ch',
]
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'io', 'ea', 'ou']
const SUFFIXES = ['', '', '', '', '', '', ' Prime', ' II', ' III', ' IV', ' V', ' Major', ' Minor']

interface NameRng {
  next(): number
}

function seedRng(seed: number): NameRng {
  // Splitmix32 state - we want deterministic mapping from seed to a stream
  // of 0..255 bytes without pulling in the Rust generator's RNG.
  let state = (seed >>> 0) ^ 0x9e3779b9
  return {
    next() {
      state = (state + 0x9e3779b9) >>> 0
      let z = state
      z = ((z ^ (z >>> 16)) * 0x85ebca6b) >>> 0
      z = ((z ^ (z >>> 13)) * 0xc2b2ae35) >>> 0
      return (z ^ (z >>> 16)) >>> 0
    },
  }
}

function pick<T>(arr: readonly T[], rng: NameRng): T {
  return arr[rng.next() % arr.length]
}

export function systemName(seed: number): string {
  const rng = seedRng(seed)
  const syllables = 2 + (rng.next() % 2)  // 2 or 3 syllables
  let name = ''
  for (let i = 0; i < syllables; i++) {
    name += pick(CONSONANTS, rng) + pick(VOWELS, rng)
  }
  // Title-case
  name = name[0].toUpperCase() + name.slice(1)
  const suffix = pick(SUFFIXES, rng)
  return name + suffix
}

export function hexName(subsectorSeed: number, col: number, row: number): string {
  // Combine seeds the same way the Rust subsector generator does so names
  // line up with the per-hex sub-seed.
  const combined = ((subsectorSeed >>> 0) * 0x9e3779b9 + ((col << 16) | row)) >>> 0
  return systemName(combined)
}

/**
 * Build a {col,row} -> unique-name map for an entire subsector. Walks the
 * grid in scan order, asks `hexName` for each cell's deterministic name,
 * and re-rolls (by perturbing the seed) on any duplicate until the name
 * is unique within the subsector. Result is itself deterministic for a
 * given subsector seed - just stably disambiguated.
 *
 * The grid is small (80 cells) and the inventory has ~100k base names,
 * so the re-roll loop typically exits in 0 or 1 attempts per hex; the
 * cap of 64 attempts is a defensive bound against pathological seeds.
 */
export function uniqueHexNames(
  subsectorSeed: number,
  coords: ReadonlyArray<{ col: number; row: number }>,
): Map<string, string> {
  const map = new Map<string, string>()
  const used = new Set<string>()
  // Sort so the disambiguation order is the same regardless of caller
  // iteration order.
  const sorted = [...coords].sort((a, b) => a.col - b.col || a.row - b.row)
  for (const { col, row } of sorted) {
    let candidate = hexName(subsectorSeed, col, row)
    let attempts = 0
    while (used.has(candidate) && attempts < 64) {
      attempts++
      // Mix the seed with the attempt counter so we walk the name space
      // deterministically until we land on something unused.
      const combined = ((subsectorSeed >>> 0) * 0x9e3779b9 + ((col << 16) | row) + attempts * 0x85EBCA6B) >>> 0
      candidate = systemName(combined)
    }
    used.add(candidate)
    map.set(`${col},${row}`, candidate)
  }
  return map
}

// Per-subsector cache of the canonical {col,row} -> display-name map, keyed by
// the subsector object identity. A regenerate or an override edit produces a
// fresh object (see applySubsectorOverrides), which naturally invalidates this.
const subsectorNameCache = new WeakMap<Subsector, Map<string, string>>()

/**
 * THE single source of truth for hex display names. Returns a deduplicated
 * `${col},${row}` -> name map for every occupied hex: an imported hex keeps its
 * explicit `name`; every other hex gets the deterministic deduped CV name. The
 * map, breadcrumb, hex panel, and exporter all resolve through here so one
 * world never shows two different names. Memoized per subsector so sector-scale
 * grids (1280 hexes) don't recompute the name table on every render.
 */
export function subsectorHexNames(subsector: Subsector): Map<string, string> {
  const cached = subsectorNameCache.get(subsector)
  if (cached) return cached
  const deduped = uniqueHexNames(
    subsector.seed,
    subsector.hexes.map((h) => h.coord),
  )
  const names = new Map<string, string>()
  for (const h of subsector.hexes) {
    const key = `${h.coord.col},${h.coord.row}`
    names.set(key, h.name ?? deduped.get(key) ?? hexName(subsector.seed, h.coord.col, h.coord.row))
  }
  subsectorNameCache.set(subsector, names)
  return names
}

/** Canonical display name for a single hex (see {@link subsectorHexNames}). */
export function resolveHexName(subsector: Subsector, coord: { col: number; row: number }): string {
  return (
    subsectorHexNames(subsector).get(`${coord.col},${coord.row}`)
    ?? hexName(subsector.seed, coord.col, coord.row)
  )
}
