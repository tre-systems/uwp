import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard', 'src'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => /\.(ts|tsx)$/.test(file))

const files = new Set(tracked)
const importsByFile = new Map(tracked.map((file) => [file, []]))

for (const file of tracked) {
  const text = readFileSync(file, 'utf8')
  const specs = [...text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
  const resolved = specs
    .map((spec) => resolveLocalImport(file, spec))
    .filter(Boolean)
  importsByFile.set(file, [...new Set(resolved)])
}

const cycles = findCycles(importsByFile)
if (cycles.length > 0) {
  console.error('Architecture check failed: local import cycles detected.')
  for (const cycle of cycles.slice(0, 20)) {
    console.error(`- ${cycle.join(' -> ')}`)
  }
  if (cycles.length > 20) console.error(`...and ${cycles.length - 20} more`)
  process.exit(1)
}

const domainViolations = []
for (const [file, deps] of importsByFile.entries()) {
  if (!file.startsWith('src/domain/')) continue
  for (const dep of deps) {
    if (dep.startsWith('src/appState/') || dep.startsWith('src/components/') || dep.startsWith('src/rendererClient/')) {
      domainViolations.push(`${file} imports ${dep}`)
    }
  }
}
if (domainViolations.length > 0) {
  console.error('Architecture check failed: domain modules must stay independent of app/UI/renderer layers.')
  console.error(domainViolations.join('\n'))
  process.exit(1)
}

console.log('Architecture check passed.')

function resolveLocalImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(root, path.dirname(fromFile), spec)
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    const rel = path.relative(root, candidate)
    if (files.has(rel)) return rel
  }
  return null
}

function findCycles(graph) {
  const cycles = []
  const stack = []
  const state = new Map()

  for (const file of graph.keys()) {
    if (!state.has(file)) visit(file)
  }
  return dedupeCycles(cycles)

  function visit(file) {
    state.set(file, 'visiting')
    stack.push(file)
    for (const dep of graph.get(file) ?? []) {
      if (state.get(dep) === 'visiting') {
        const start = stack.indexOf(dep)
        cycles.push([...stack.slice(start), dep])
      } else if (!state.has(dep)) {
        visit(dep)
      }
    }
    stack.pop()
    state.set(file, 'done')
  }
}

function dedupeCycles(cycles) {
  const seen = new Set()
  const out = []
  for (const cycle of cycles) {
    const key = canonicalCycleKey(cycle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cycle)
  }
  return out
}

function canonicalCycleKey(cycle) {
  const nodes = cycle.slice(0, -1)
  let best = nodes.join(' -> ')
  for (let i = 1; i < nodes.length; i++) {
    const rotated = [...nodes.slice(i), ...nodes.slice(0, i)].join(' -> ')
    if (rotated < best) best = rotated
  }
  return best
}
