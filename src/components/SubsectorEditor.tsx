import {
  currentSubsector,
  rerollSubsectorSeed,
  selectedHex,
  setShowJumpRoutes,
  setSubsectorDensity,
  setSubsectorSeed,
  showJumpRoutes,
  subsectorDensity,
  subsectorSeed,
} from '../appState'
import { SeedField } from './SeedField'
import { useState } from 'preact/hooks'
import {
  hexLabel,
  routeNeighbor,
  routesForHex,
  subsectorHexCount,
  subsectorToText,
  uwpToCode,
  type Subsector,
  type SubsectorHex,
} from '../domain/subsector'
import { deriveTradeCodes, tradeCodeName } from '../domain/cepheus'
import { systemName } from '../domain/names'

interface SubsectorEditorProps {
  disabled: boolean
}

export function SubsectorEditor({ disabled }: SubsectorEditorProps) {
  const sub = currentSubsector.value
  const density = subsectorDensity.value
  const seed = subsectorSeed.value
  const sel = selectedHex.value
  const routesVisible = showJumpRoutes.value
  const occupied = sub?.hexes.length ?? 0
  const routesCount = sub?.jump_routes.length ?? 0
  const commRoutesCount = sub?.jump_routes.filter((route) => route.communication).length ?? 0
  const tradeRoutesCount = sub?.jump_routes.filter((route) => route.trade).length ?? 0
  const total = sub ? subsectorHexCount(sub) : 16 * 10
  const selectedDetail = sub && sel
    ? sub.hexes.find((h) => h.coord.col === sel.col && h.coord.row === sel.row) ?? null
    : null

  return (
    <>
      <section>
        <h2>{sub ? `${systemName(seed)} Sector` : 'Subsector'}</h2>
        <dl class="sys-meta">
          <div class="sys-meta-row">
            <dt>Allegiance</dt>
            <dd>{sub?.allegiance ?? '—'}</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Occupied</dt>
            <dd>{occupied} / {total} hexes</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Density</dt>
            <dd>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={density}
                disabled={disabled}
                onInput={(e) => setSubsectorDensity(Number((e.currentTarget as HTMLInputElement).value))}
                aria-label="Subsector density"
              />
              <span class="sys-unit">{Math.round(density * 100)}%</span>
            </dd>
          </div>
          <div class="sys-meta-row">
            <dt>Jump routes</dt>
            <dd>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={routesVisible}
                  disabled={disabled}
                  onChange={(e) => setShowJumpRoutes((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{routesCount} links · {commRoutesCount} comms · {tradeRoutesCount} trade</span>
              </label>
            </dd>
          </div>
        </dl>
        <div class="sys-actions">
          <button onClick={rerollSubsectorSeed} disabled={disabled}>
            New region
          </button>
          <SeedField
            value={seed}
            disabled={disabled}
            onChange={setSubsectorSeed}
            aria-label="Subsector seed"
          />
        </div>
        {sub && <SubsectorExportRow subsector={sub} disabled={disabled} />}
      </section>

      {sub && selectedDetail && <HexDetailSection subsector={sub} hex={selectedDetail} />}
    </>
  )
}

function SubsectorExportRow({ subsector, disabled }: { subsector: Subsector; disabled: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(subsectorToText(subsector))
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 1500)
    } catch {
      setStatus('failed')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }

  const download = () => {
    const text = subsectorToText(subsector)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subsector-${systemName(subsector.seed).toLowerCase()}-${subsector.seed}.tab`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const copyLabel = status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy as text'
  return (
    <div class="sys-actions sys-export-row">
      <button type="button" onClick={copy} disabled={disabled} title="Copy subsector as plain-text table">
        {copyLabel}
      </button>
      <button type="button" onClick={download} disabled={disabled} title="Download as .tab file">
        Download .tab
      </button>
    </div>
  )
}

function HexDetailSection({ subsector, hex }: { subsector: Subsector; hex: SubsectorHex }) {
  const tradeCodes = deriveTradeCodes({
    size: hex.uwp.size,
    atm: hex.uwp.atm,
    hydro: hex.uwp.hydro,
    pop: hex.uwp.pop,
    gov: hex.uwp.gov,
    law: hex.uwp.law,
    tech: hex.uwp.tech,
  })
  const baseList: string[] = []
  if (hex.bases.naval) baseList.push('Naval')
  if (hex.bases.scout) baseList.push('Scout')
  if (hex.bases.research) baseList.push('Research')
  if (hex.bases.Aid) baseList.push('Aid')
  const name = systemName(hex.system_seed)
  const routes = routesForHex(subsector, hex.coord)
  const commRoutes = routes.filter((route) => route.communication)
  const tradeRoutes = routes.filter((route) => route.trade)
  const routeChips = routes
    .filter((route) => route.communication || route.trade)
    .slice()
    .sort((a, b) => Number(b.trade) - Number(a.trade) || b.trade_score - a.trade_score || a.jump - b.jump)
    .slice(0, 4)
  return (
    <section>
      <h2>{name} · {hexLabel(hex.coord)}</h2>
      <dl class="sys-meta">
        <div class="sys-meta-row">
          <dt>UWP</dt>
          <dd class="hex-detail-uwp">{uwpToCode(hex.uwp)}</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Travel zone</dt>
          <dd class={`zone-tag zone-tag-${hex.travel_zone.toLowerCase()}`}>{hex.travel_zone}</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Bases</dt>
          <dd>{baseList.length > 0 ? baseList.join(', ') : '—'}</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Features</dt>
          <dd>
            {hex.gas_giant ? 'Gas giant' : null}
            {hex.gas_giant && hex.belts ? ' · ' : null}
            {hex.belts ? 'Asteroid belt' : null}
            {!hex.gas_giant && !hex.belts ? '—' : null}
          </dd>
        </div>
        <div class="sys-meta-row">
          <dt>Routes</dt>
          <dd>{commRoutes.length} comms · {tradeRoutes.length} trade</dd>
        </div>
      </dl>
      {routeChips.length > 0 && (
        <div class="route-codes" aria-label="Routes touching the selected hex">
          <span class="trade-codes-label">Route links</span>
          <span class="trade-codes-list">
            {routeChips.map((route) => {
              const neighbor = routeNeighbor(route, hex.coord)
              const label = `${hexLabel(neighbor)} J-${route.jump}${route.trade ? ` T${route.trade_score}` : ' C'}`
              return (
                <span
                  key={`${neighbor.col},${neighbor.row},${route.jump},${route.trade_score}`}
                  class={`route-chip${route.trade ? ' route-chip-trade' : ' route-chip-comm'}`}
                  title={route.trade ? 'Trade route' : 'Communications route'}
                >
                  {label}
                </span>
              )
            })}
            {routes.length > routeChips.length && (
              <span class="route-chip route-chip-more">+{routes.length - routeChips.length}</span>
            )}
          </span>
        </div>
      )}
      {tradeCodes.length > 0 && (
        <div class="trade-codes" aria-label="Trade codes for the selected hex">
          <span class="trade-codes-label">Trade codes</span>
          <span class="trade-codes-list">
            {tradeCodes.map((code) => (
              <abbr
                key={code}
                class="trade-chip"
                title={tradeCodeName(code)}
                tabIndex={0}
              >
                {code}
              </abbr>
            ))}
          </span>
        </div>
      )}
    </section>
  )
}
