import {
  currentSystem,
  currentSurfaceMap,
  openRegionView,
  pointAtSurface,
  selectedSurfaceCell,
  selectedSurfaceHex,
  selectedSurfaceTargetLabel,
  setSelectedSurfaceHex,
  setViewMode,
} from '../appState'
import {
  hexCoordLabel,
  terrainLabel,
  type SurfaceHex,
} from '../domain/surfaceMap'

// Sidebar inspector for the surface view. Summarises the planet's surface
// stats and shows the per-hex breakdown for the user's selection so a GM
// can read "Hex 0408 - temperate forest, 287 K, near sea level".

interface SurfaceMapEditorProps {
  disabled: boolean
}

export function SurfaceMapEditor({ disabled: _disabled }: SurfaceMapEditorProps) {
  const map = currentSurfaceMap.value
  const system = currentSystem.value
  const targetLabel = selectedSurfaceTargetLabel()
  const sel = selectedSurfaceHex.value
  const exactSelection = selectedSurfaceCell.value
  if (!map) {
    return (
      <section>
        <h2>Surface</h2>
        <p class="sys-meta sys-empty">No surface map — select a planet. Stars and belts do not have hex surfaces.</p>
      </section>
    )
  }
  const selected = exactSelection ?? (sel
    ? map.hexes.find((h) => h.coord.col === sel.col && h.coord.row === sel.row) ?? null
    : null)
  const selectedCellKey = selected?.cell_id ? cellIdKey(selected.cell_id) : null
  const starportSelected = selectedCellKey && map.starport_cell_id
    ? selectedCellKey === cellIdKey(map.starport_cell_id)
    : !!selected && !!map.starport && map.starport.col === selected.coord.col && map.starport.row === selected.coord.row
  const gridLabel = map.atlas
    ? `${map.atlas.cells.length.toLocaleString()} atlas cells`
    : '32 x 16 hexes'
  const cityCount = map.cities.length
  const starportLabel = map.starport ? hexCoordLabel(map.starport) : '—'
  return (
    <>
      <section>
        <h2>Surface</h2>
        <dl class="sys-meta">
          <div class="sys-meta-row">
            <dt>Body</dt>
            <dd>{system ? targetLabel : '—'}</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Grid</dt>
            <dd>{gridLabel}</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Ocean</dt>
            <dd>{(map.ocean_fraction * 100).toFixed(0)}%</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Starport</dt>
            <dd>{starportLabel}</dd>
          </div>
          <div class="sys-meta-row">
            <dt>Settlements</dt>
            <dd>{cityCount}</dd>
          </div>
        </dl>
        {selected && (
          <button class="ghost" onClick={() => setSelectedSurfaceHex(null)} style={{ marginTop: 8 }}>
            Clear selection
          </button>
        )}
      </section>

      {selected && <SurfaceHexDetail hex={selected} starportSelected={!!starportSelected} />}
    </>
  )
}

function SurfaceHexDetail({ hex, starportSelected }: { hex: SurfaceHex; starportSelected: boolean }) {
  const showOnGlobe = () => {
    pointAtSurface(hex.latitude_deg, hex.longitude_deg)
    setViewMode('detail')
  }
  return (
    <section>
      <h2>Hex {hexCoordLabel(hex.coord)}</h2>
      <dl class="sys-meta">
        <div class="sys-meta-row">
          <dt>Terrain</dt>
          <dd>{terrainLabel(hex.terrain)}</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Latitude</dt>
          <dd>{hex.latitude_deg.toFixed(1)}°</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Longitude</dt>
          <dd>{hex.longitude_deg.toFixed(1)}°</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Temperature</dt>
          <dd>{hex.temperature_k.toFixed(0)} K</dd>
        </div>
        <div class="sys-meta-row">
          <dt>Elevation</dt>
          <dd>{(hex.elevation * 100).toFixed(0)}%</dd>
        </div>
        {starportSelected && (
          <div class="sys-meta-row">
            <dt>Notes</dt>
            <dd>Main starport sits here.</dd>
          </div>
        )}
      </dl>
      <div class="sys-actions">
        <button onClick={() => openRegionView(hex.coord, hex)}>Open region view</button>
        <button class="ghost" onClick={showOnGlobe}>Show on globe</button>
      </div>
    </section>
  )
}

function cellIdKey(id: NonNullable<SurfaceHex['cell_id']>): string {
  return `${id.resolution}:${id.face}:${id.i}:${id.j}:${id.up ? 1 : 0}`
}
