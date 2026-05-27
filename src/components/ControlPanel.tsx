import { useState } from 'preact/hooks'
import {
  currentSystem,
  panelOpen,
  params,
  randomizeUwp,
  resetUwp,
  setUwpField,
  setUwpFromCode,
  systemSeed,
  togglePanel,
  updateParams,
  uwp,
  uwpToCode,
  viewMode,
} from '../appState'
import { AboutModal } from './AboutModal'
import { DetailTargetPanel } from './DetailTargetPanel'
import { ExportPanel } from './ExportPanel'
import { GlossaryModal } from './GlossaryModal'
import { ShareButton } from './ShareButton'
import { SocietyEditor } from './SocietyEditor'
import { SubsectorEditor } from './SubsectorEditor'
import { SurfaceMapEditor } from './SurfaceMapEditor'
import { StarportEditor } from './StarportEditor'
import { SystemEditor } from './SystemEditor'
import { PerformanceControls } from './PerformanceControls'
import { UwpCodeEditor } from './UwpCodeEditor'
import { ViewControls } from './ViewControls'
import { WorldProfileEditor } from './WorldProfileEditor'
import { formatBodyViewLabel, formatSurfaceCrumbLabel, resolvedDetailTarget } from '../navigation/bodyView'

export function ControlPanel() {
  // Accessing .value inside JSX subscribes the component to changes.
  const u = uwp.value
  const p = params.value
  const open = panelOpen.value
  const mode = viewMode.value
  const sys = currentSystem.value
  const target = resolvedDetailTarget(sys)
  const bodyLabel = formatBodyViewLabel(sys, target)
  const surfaceLabel = formatSurfaceCrumbLabel(sys, target)
  const _ = systemSeed.value  // subscribe so the panel re-renders on seed change
  void _
  const codeText = uwpToCode(u)
  const panelId = 'controls-panel'
  const controlsDisabled = !open
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <>
      <button
        class={`panel-toggle ${open ? 'panel-toggle-open' : ''}`}
        onClick={togglePanel}
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? 'Hide controls' : 'Show controls'}
        title={open ? 'Hide controls' : 'Show controls'}
      >
        {open ? '✕' : '☰'}
      </button>

      <aside id={panelId} class={`panel ${open ? '' : 'panel-closed'}`} aria-hidden={!open} inert={!open}>
        <header class="panel-header">
          <h1>{mode === 'subsector' ? 'Subsector' : mode === 'system' ? 'System' : mode === 'surface' ? surfaceLabel : bodyLabel}</h1>
          <div class="panel-actions">
            {mode === 'detail' && !target && (
              <>
                <button onClick={randomizeUwp} disabled={controlsDisabled}>Randomize</button>
                <button class="ghost" onClick={resetUwp} disabled={controlsDisabled}>Reset</button>
              </>
            )}
            <ShareButton disabled={controlsDisabled} />
            <button
              class="ghost glossary-trigger"
              onClick={() => setGlossaryOpen(true)}
              disabled={controlsDisabled}
              title="Cepheus glossary"
              aria-label="Open glossary"
            >
              ?
            </button>
          </div>
        </header>

        {mode === 'subsector' && (
          <SubsectorEditor disabled={controlsDisabled} />
        )}

        {mode === 'surface' && (
          <SurfaceMapEditor disabled={controlsDisabled} />
        )}

        {mode === 'system' && sys && (
          <SystemEditor system={sys} disabled={controlsDisabled} />
        )}

        {mode === 'detail' && target && sys && (
          <>
            <DetailTargetPanel system={sys} target={target} disabled={controlsDisabled} />
            <ViewControls params={p} disabled={controlsDisabled} onParamsChange={updateParams} />
            <PerformanceControls disabled={controlsDisabled} />
          </>
        )}

        {mode === 'detail' && (!target || !sys) && (
          <>
            <UwpCodeEditor codeText={codeText} disabled={controlsDisabled} onCodeChange={setUwpFromCode} />
            <StarportEditor
              starport={u.starport}
              disabled={controlsDisabled}
              onChange={(starport) => setUwpField('starport', starport)}
            />
            <WorldProfileEditor uwp={u} disabled={controlsDisabled} onFieldChange={setUwpField} />
            <SocietyEditor uwp={u} disabled={controlsDisabled} onFieldChange={setUwpField} />
            <ViewControls params={p} disabled={controlsDisabled} onParamsChange={updateParams} />
            <PerformanceControls disabled={controlsDisabled} />
          </>
        )}

        {mode === 'system' && (
          <PerformanceControls disabled={controlsDisabled} />
        )}

        {(mode === 'detail' || mode === 'system') && (
          <ExportPanel disabled={controlsDisabled} allowCard={mode === 'detail' && !target} />
        )}

        <footer class="panel-footer">
          {/* The 3D detail / system views orbit a camera; the 2D
              subsector / surface SVGs only pan. Show the verb that
              actually applies in this mode. */}
          <span>
            {mode === 'detail' || mode === 'system'
              ? 'Drag to orbit · pinch or scroll to zoom'
              : 'Drag to pan · pinch or scroll to zoom'}
          </span>
          <button
            class="link"
            onClick={() => setAboutOpen(true)}
            disabled={controlsDisabled}
          >
            About
          </button>
        </footer>
      </aside>
      <GlossaryModal open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}
