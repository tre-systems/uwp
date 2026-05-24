import { type Params } from '../appState'
import { Slider } from './Slider'

interface ViewControlsProps {
  params: Params
  disabled: boolean
  onParamsChange: (patch: Partial<Params>) => void
}

export function ViewControls({ params, disabled, onParamsChange }: ViewControlsProps) {
  return (
    <section>
      <h2>View</h2>
      <Slider
        label="Seed"
        value={params.seed}
        min={0}
        max={0xffffffff}
        step={1}
        disabled={disabled}
        format={(v) => v.toFixed(0)}
        onInput={(v) => onParamsChange({ seed: v })}
      />
      <Slider
        label="Sun angle"
        value={params.sun_angle}
        min={0}
        max={1}
        disabled={disabled}
        onInput={(v) => onParamsChange({ sun_angle: v })}
      />
      <Slider
        label="Auto rotate"
        value={params.auto_rotate}
        min={0}
        max={0.6}
        disabled={disabled}
        onInput={(v) => onParamsChange({ auto_rotate: v })}
      />
    </section>
  )
}
