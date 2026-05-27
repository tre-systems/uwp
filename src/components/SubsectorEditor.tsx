import {
  currentSubsector,
  clearSubsectorHexOverride,
  generatedSubsectorHex,
  getSubsectorHexOverride,
  getSubsectorRouteOverride,
  rerollSubsectorSeed,
  selectedHex,
  clearSubsectorRouteOverride,
  setSubsectorHexOverride,
  setSubsectorRouteOverride,
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
  allegianceForCode,
  hexLabel,
  pbgCode,
  isRouteVisible,
  populationLabel,
  politySummaries,
  routeNeighbor,
  routesForHex,
  routeDisplayKind,
  subsectorHexCount,
  subsectorToText,
  uwpToCode,
  visibleRoutes,
  type JumpRoute,
  type Subsector,
  type SubsectorHex,
  type TravelZone,
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
  const routes = sub ? visibleRoutes(sub) : []
  const routesCount = sub?.jump_routes.length ?? 0
  const commRoutesCount = routes.filter((route) => route.communication).length
  const tradeRoutesCount = routes.filter((route) => route.trade).length
  const polities = sub ? politySummaries(sub) : []
  const total = sub ? subsectorHexCount(sub) : 16 * 10
  const selectedDetail = sub && sel
    ? sub.hexes.find((h) => h.coord.col === sel.col && h.coord.row === sel.row) ?? null
    : null
  const visibleRouteCount = routes.length
  const hiddenRouteCount = Math.max(0, routesCount - visibleRouteCount)

  return (
    <>
      <section>
        <h2>{sub ? `${systemName(seed)} Sector` : 'Subsector'}</h2>
        <dl class="sys-meta">
          <div class="sys-meta-row">
            <dt>Polities</dt>
            <dd>
              {polities.length > 0
                ? polities.map(({ allegiance, count, territory, capitalHex }) => (
                  <span
                    key={allegiance.code}
                    class={`polity-chip polity-chip-${Math.max(0, Math.min(5, Math.trunc(allegiance.color_index)))}`}
                    title={`${allegiance.name}; capital ${hexLabel(capitalHex?.coord ?? allegiance.capital)}`}
                  >
                    {allegiance.code} {count}/{territory}
                  </span>
                ))
                : '—'}
            </dd>
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
                <span>
                  {visibleRouteCount} shown · {commRoutesCount} comms · {tradeRoutesCount} trade
                  {hiddenRouteCount > 0 ? ` · ${hiddenRouteCount} hidden` : ''}
                </span>
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
      {sub && sel && !selectedDetail && (
        <TerritoryDetailSection subsector={sub} coord={sel} />
      )}
    </>
  )
}

function TerritoryDetailSection({ subsector, coord }: { subsector: Subsector; coord: { col: number; row: number } }) {
  const cell = subsector.polity_cells?.find((c) => c.coord.col === coord.col && c.coord.row === coord.row) ?? null
  const allegiance = cell ? allegianceForCode(subsector, cell.allegiance) : null
  return (
    <section>
      <h2>Hex {hexLabel(coord)}</h2>
      <dl class="sys-meta">
        <div class="sys-meta-row">
          <dt>Status</dt>
          <dd>No star system (empty hex)</dd>
        </div>
        {cell && (
          <>
            <div class="sys-meta-row">
              <dt>Allegiance</dt>
              <dd>
                <span
                  class={`polity-chip polity-chip-${Math.max(0, Math.min(5, Math.trunc(allegiance?.color_index ?? 2)))}`}
                >
                  {cell.allegiance}
                </span>
                <span class="sys-unit">{allegiance?.name ?? 'Uncatalogued'}</span>
              </dd>
            </div>
            {cell.capital && (
              <div class="sys-meta-row">
                <dt>Capital</dt>
                <dd>Polity capital hex</dd>
              </div>
            )}
          </>
        )}
      </dl>
    </section>
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
  if (hex.bases.aid) baseList.push('Aid')
  const name = systemName(hex.system_seed)
  const allegiance = allegianceForCode(subsector, hex.allegiance)
  const generatedHex = generatedSubsectorHex(hex.coord)
  const override = getSubsectorHexOverride(subsector.seed, hex.coord)
  const polity = politySummaries(subsector).find((summary) => summary.allegiance.code === hex.allegiance)
  const isCapital = !!polity?.capitalHex && polity.capitalHex.coord.col === hex.coord.col && polity.capitalHex.coord.row === hex.coord.row
  const routes = routesForHex(subsector, hex.coord)
  const shownRoutes = routes.filter(isRouteVisible)
  const commRoutes = shownRoutes.filter((route) => route.communication)
  const tradeRoutes = shownRoutes.filter((route) => route.trade)
  const routeChips = routes
    .filter((route) => isRouteVisible(route) && (route.communication || route.trade))
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
          <dt>Allegiance</dt>
          <dd>
            <span
              class={`polity-chip polity-chip-${Math.max(0, Math.min(5, Math.trunc(allegiance?.color_index ?? 2)))}`}
              title={allegiance?.name ?? hex.allegiance}
            >
              {hex.allegiance}
            </span>
            <span class="sys-unit">
              {allegiance?.name ?? 'Uncatalogued'}
              {isCapital ? ' capital' : ''}
            </span>
          </dd>
        </div>
        {polity && (
          <div class="sys-meta-row">
            <dt>Polity</dt>
            <dd>
              {polity.count} worlds · {polity.territory} hexes
              {polity.capitalHex ? ` · capital ${hexLabel(polity.capitalHex.coord)}` : ''}
            </dd>
          </div>
        )}
        <div class="sys-meta-row">
          <dt>Bases</dt>
          <dd>{baseList.length > 0 ? baseList.join(', ') : '—'}</dd>
        </div>
        <div class="sys-meta-row">
          <dt>PBG</dt>
          <dd>
            {pbgCode(hex.pbg)}
            <span class="sys-unit">
              {populationLabel(hex.population)} people · {hex.pbg.belts} belts · {hex.pbg.gas_giants} gas giants
            </span>
          </dd>
        </div>
        <div class="sys-meta-row">
          <dt>Overrides</dt>
          <dd>{override ? 'Edited by referee' : 'Generated'}</dd>
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
          <dd>
            {commRoutes.length} comms · {tradeRoutes.length} trade
            {routes.length > shownRoutes.length ? ` · ${routes.length - shownRoutes.length} hidden` : ''}
          </dd>
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
            {shownRoutes.length > routeChips.length && (
              <span class="route-chip route-chip-more">+{shownRoutes.length - routeChips.length}</span>
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
      <RefereeOverrideControls
        subsector={subsector}
        hex={hex}
        generatedHex={generatedHex}
        hasOverride={!!override}
      />
      {routes.length > 0 && <RouteOverrideControls subsector={subsector} hex={hex} routes={routes} />}
    </section>
  )
}

function RouteOverrideControls({
  subsector,
  hex,
  routes,
}: {
  subsector: Subsector
  hex: SubsectorHex
  routes: JumpRoute[]
}) {
  const sortedRoutes = routes.slice().sort((a, b) => {
    const visibleDelta = Number(isRouteVisible(b)) - Number(isRouteVisible(a))
    if (visibleDelta !== 0) return visibleDelta
    const kindDelta = routeKindRank(b) - routeKindRank(a)
    if (kindDelta !== 0) return kindDelta
    return hexLabel(routeNeighbor(a, hex.coord)).localeCompare(hexLabel(routeNeighbor(b, hex.coord)))
  })
  return (
    <div class="trade-codes" aria-label="Referee route overrides for the selected hex">
      <span class="trade-codes-label">Route overrides</span>
      <div class="trade-codes-list">
        {sortedRoutes.map((route) => {
          const neighbor = routeNeighbor(route, hex.coord)
          const override = getSubsectorRouteOverride(subsector.seed, route)
          const routeName = `${hexLabel(hex.coord)} to ${hexLabel(neighbor)}`
          const visible = isRouteVisible(route)
          const kind = routeDisplayKind(route)
          return (
            <fieldset
              class="route-override-row"
              key={`${route.from.col},${route.from.row}-${route.to.col},${route.to.row}`}
              aria-label={`Override route ${routeName}`}
            >
              <legend class="trade-codes-label">
                {hexLabel(neighbor)} · J-{route.jump} · {kind === 'communication' ? 'comms' : kind}
              </legend>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => setSubsectorRouteOverride(route, {
                    visible: (e.currentTarget as HTMLInputElement).checked,
                  })}
                />
                <span>Show</span>
              </label>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={route.communication}
                  onChange={(e) => setSubsectorRouteOverride(route, {
                    communication: (e.currentTarget as HTMLInputElement).checked,
                  })}
                />
                <span>Comms</span>
              </label>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={route.trade}
                  onChange={(e) => setSubsectorRouteOverride(route, {
                    trade: (e.currentTarget as HTMLInputElement).checked,
                  })}
                />
                <span>Trade</span>
              </label>
              <label class="toggle-label">
                <span>Score</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  step={1}
                  value={Math.max(1, route.trade_score)}
                  disabled={!route.trade}
                  aria-label={`Override trade score for route ${routeName}`}
                  onInput={(e) => setSubsectorRouteOverride(route, {
                    trade_score: Number((e.currentTarget as HTMLInputElement).value),
                  })}
                />
              </label>
              <button
                type="button"
                onClick={() => clearSubsectorRouteOverride(route)}
                disabled={!override}
                title={`Reset route ${routeName} to generated metadata`}
                aria-label={`Reset route ${routeName} to generated metadata`}
              >
                Reset route
              </button>
            </fieldset>
          )
        })}
      </div>
    </div>
  )
}

function routeKindRank(route: JumpRoute): number {
  switch (routeDisplayKind(route)) {
    case 'trade': return 2
    case 'communication': return 1
    default: return 0
  }
}

function RefereeOverrideControls({
  subsector,
  hex,
  generatedHex,
  hasOverride,
}: {
  subsector: Subsector
  hex: SubsectorHex
  generatedHex: SubsectorHex | null
  hasOverride: boolean
}) {
  const updateBase = (field: keyof SubsectorHex['bases'], checked: boolean) => {
    setSubsectorHexOverride(hex.coord, {
      bases: {
        ...hex.bases,
        [field]: checked,
      },
    })
  }
  const resetLabel = generatedHex
    ? `Reset hex overrides to generated ${generatedHex.travel_zone} / ${generatedHex.allegiance}`
    : 'Reset hex overrides'
  return (
    <div class="trade-codes" aria-label="Referee overrides for the selected hex">
      <span class="trade-codes-label">Referee overrides</span>
      <div class="trade-codes-list">
        <label class="toggle-label">
          <span>Zone</span>
          <select
            value={hex.travel_zone}
            onChange={(e) => setSubsectorHexOverride(hex.coord, {
              travel_zone: (e.currentTarget as HTMLSelectElement).value as TravelZone,
            })}
            aria-label="Override travel zone"
          >
            <option value="Green">Green</option>
            <option value="Amber">Amber</option>
            <option value="Red">Red</option>
          </select>
        </label>
        <label class="toggle-label">
          <span>Allegiance</span>
          <select
            value={hex.allegiance}
            onChange={(e) => setSubsectorHexOverride(hex.coord, {
              allegiance: (e.currentTarget as HTMLSelectElement).value,
            })}
            aria-label="Override allegiance"
          >
            {subsector.allegiances.map((a) => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </select>
        </label>
        <fieldset class="route-codes" aria-label="Override bases">
          <legend class="trade-codes-label">Bases</legend>
          {([
            ['naval', 'Naval'],
            ['scout', 'Scout'],
            ['research', 'Research'],
            ['aid', 'Aid'],
          ] as const).map(([field, label]) => (
            <label class="toggle-label" key={field}>
              <input
                type="checkbox"
                checked={hex.bases[field]}
                onChange={(e) => updateBase(field, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={() => clearSubsectorHexOverride(hex.coord)}
          disabled={!hasOverride}
          title={resetLabel}
          aria-label={resetLabel}
        >
          Reset overrides
        </button>
      </div>
    </div>
  )
}
