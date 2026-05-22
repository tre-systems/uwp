import { panelOpen, params, randomize, reset, updateParams } from '../state'
import { Slider } from './Slider'
import { ColorInput } from './ColorInput'

export function ControlPanel() {
  // Accessing .value inside JSX subscribes the component to changes.
  const p = params.value
  const open = panelOpen.value
  const toggle = () => (panelOpen.value = !panelOpen.value)

  return (
    <aside class={`panel ${open ? '' : 'panel-closed'}`}>
      <button class="panel-toggle" onClick={toggle} title={open ? 'Hide controls' : 'Show controls'}>
        {open ? '⟩' : '⟨'}
      </button>

      <header class="panel-header">
        <h1>Planetto</h1>
        <div class="panel-actions">
          <button onClick={randomize}>Randomize</button>
          <button class="ghost" onClick={reset}>Reset</button>
        </div>
      </header>

      <section>
        <h2>Geology</h2>
        <Slider label="Seed" value={p.seed} min={0} max={0xffffffff} step={1}
                format={(v) => v.toFixed(0)}
                onInput={(v) => updateParams({ seed: v })} />
        <Slider label="Sea level" value={p.sea_level} min={0.1} max={0.9}
                onInput={(v) => updateParams({ sea_level: v })} />
        <Slider label="Mountains" value={p.mountain_height} min={0} max={0.45}
                onInput={(v) => updateParams({ mountain_height: v })} />
        <Slider label="Detail" value={p.noise_frequency} min={0.6} max={3.6}
                onInput={(v) => updateParams({ noise_frequency: v })} />
        <Slider label="Roughness" value={p.noise_octaves} min={3} max={9} step={1}
                format={(v) => v.toFixed(0)}
                onInput={(v) => updateParams({ noise_octaves: v })} />
      </section>

      <section>
        <h2>Climate</h2>
        <Slider label="Ice latitude" value={p.ice_latitude} min={0.45} max={1}
                onInput={(v) => updateParams({ ice_latitude: v })} />
        <Slider label="Clouds" value={p.cloud_coverage} min={0} max={1}
                onInput={(v) => updateParams({ cloud_coverage: v })} />
        <Slider label="Atmosphere" value={p.atmosphere_density} min={0} max={1.5}
                onInput={(v) => updateParams({ atmosphere_density: v })} />
      </section>

      <section>
        <h2>Lighting</h2>
        <Slider label="Sun angle" value={p.sun_angle} min={0} max={1}
                onInput={(v) => updateParams({ sun_angle: v })} />
        <Slider label="Auto rotate" value={p.auto_rotate} min={0} max={0.6}
                onInput={(v) => updateParams({ auto_rotate: v })} />
      </section>

      <section>
        <h2>Palette</h2>
        <ColorInput label="Atmosphere" value={p.atmosphere_color}
                onInput={(v) => updateParams({ atmosphere_color: v })} />
        <ColorInput label="Ocean" value={p.ocean_color}
                onInput={(v) => updateParams({ ocean_color: v })} />
        <ColorInput label="Land" value={p.land_color}
                onInput={(v) => updateParams({ land_color: v })} />
        <ColorInput label="Sand" value={p.sand_color}
                onInput={(v) => updateParams({ sand_color: v })} />
        <ColorInput label="Mountains" value={p.mountain_color}
                onInput={(v) => updateParams({ mountain_color: v })} />
        <ColorInput label="Ice" value={p.snow_color}
                onInput={(v) => updateParams({ snow_color: v })} />
      </section>

      <footer class="panel-footer">
        <span>Drag to orbit · scroll to zoom</span>
      </footer>
    </aside>
  )
}
