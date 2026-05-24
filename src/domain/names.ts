// Deterministic, pronounceable system / hex name generator.
//
// Seed -> CV-CV-CV pattern from a small consonant + vowel inventory so
// every name is short, easy to say out loud, and unique enough across
// 4 billion seeds. Optionally appends a Greek-letter suffix for a small
// fraction of seeds to break the monotony of pure stems.
//
// The bigram lists were tuned to avoid name-sequences that read as
// English words; the inventory leans Cepheus / legacy 2d6 flavour
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
