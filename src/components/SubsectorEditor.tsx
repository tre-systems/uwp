import {
  currentSubsector,
  rerollSubsectorSeed,
  selectedHex,
  setShowJumpRoutes,
  setSubsectorDensity,
  showJumpRoutes,
  subsectorDensity,
  subsectorSeed,
} from '../appState'
import {
  hexLabel,
  uwpToCode,
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
  const total = 8 * 10
  const selectedDetail = sub && sel
    ? sub.hexes.find((h) => h.coord.col === sel.col && h.coord.row === sel.row) ?? null
    : null

  return (
    <>
      <section>
        <h2>Subsector</h2>
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
                <span>{routesCount} link{routesCount === 1 ? '' : 's'}</span>
              </label>
            </dd>
          </div>
        </dl>
        <div class="sys-actions">
          <button onClick={rerollSubsectorSeed} disabled={disabled}>
            New subsector
          </button>
          <span class="sys-seed">seed {seed}</span>
        </div>
      </section>

      {selectedDetail && <HexDetailSection hex={selectedDetail} />}
    </>
  )
}

function HexDetailSection({ hex }: { hex: SubsectorHex }) {
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
      </dl>
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
