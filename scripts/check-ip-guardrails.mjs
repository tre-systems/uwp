import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const join = (...parts) => parts.join('')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const word = (value, suffix = '') => new RegExp(`\\b${escapeRegExp(value)}${suffix}\\b`, 'iu')

const protectedGameMarkA = join('Trave', 'ller')
const protectedGameMarkB = join('Trave', 'ler')

const rules = [
  { label: 'protected game mark', pattern: word(protectedGameMarkA, "(?:s|'s)?") },
  { label: 'protected game mark variant', pattern: word(protectedGameMarkB, "(?:s|'s)?") },
  { label: 'publisher mark', pattern: word(join('Mon', 'goose')) },
  { label: 'rightsholder name', pattern: word(join('Far ', 'Future')) },
  { label: 'creator name', pattern: word(join('Marc ', 'Miller')) },
  { label: 'legacy publisher abbreviation', pattern: word(join('G', 'DW')) },
  { label: 'legacy publisher name', pattern: word(join('Game ', 'Designers')) },
  { label: 'protected setting name', pattern: word(join('Charted ', 'Space')) },
  { label: 'protected setting term', pattern: word(join('Third ', 'Impe', 'rium')) },
  { label: 'protected setting term', pattern: word(join('Impe', 'rium')) },
  { label: 'protected setting term', pattern: word(join('Vil', 'ani')) },
  { label: 'protected setting term', pattern: word(join('Zho', 'dani')) },
  { label: 'protected setting term', pattern: word(join('Var', 'gr')) },
  { label: 'protected setting term', pattern: word(join('As', 'lan')) },
  { label: 'protected setting term', pattern: word(join('Solo', 'mani')) },
  { label: 'protected setting term', pattern: word(join("K'", 'kree')) },
  { label: 'protected setting term', pattern: word(join('Hi', 'ver')) },
  { label: 'protected setting term', pattern: word(join('Droy', 'ne')) },
  { label: 'protected organization abbreviation', pattern: word(join('II', 'SS')) },
  { label: 'protected publication abbreviation', pattern: word(join('J', 'T', 'AS')) },
  { label: 'protected organization abbreviation', pattern: word(join('T', 'AS')) },
  { label: 'protected product shorthand', pattern: word(join('Book ', '6')) },
  { label: 'protected map-domain reference', pattern: word(`${protectedGameMarkA.toLowerCase()}map`) },
  { label: 'protected rules-domain reference', pattern: word(`${protectedGameMarkA.toLowerCase()}-srd`) },
  { label: 'protected wiki-domain reference', pattern: word(`${protectedGameMarkA.toLowerCase()}rpg`) },
]

const findings = []

for (const file of trackedFiles) {
  let content
  try {
    content = readFileSync(file)
  } catch {
    continue
  }
  if (content.includes(0)) continue

  const text = content.toString('utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${rule.label}`)
      }
    }
  })
}

if (findings.length > 0) {
  console.error('IP guardrail check failed:')
  console.error(findings.join('\n'))
  process.exit(1)
}

console.log('IP guardrail check passed.')
