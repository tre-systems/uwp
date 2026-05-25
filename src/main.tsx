import { render } from 'preact'
import { App } from './app'
import { installServiceWorkerAutoReload, publishBuildId } from './buildId'
import {
  installPreferencePersistence,
  loadPersistedPreferences,
} from './appState/persistence'
import {
  installUrlStateMirror,
  loadUrlState,
} from './appState/urlState'
import {
  installSubsectorOverridePersistence,
  loadPersistedSubsectorOverrides,
} from './appState/subsectorOverridePersistence'
import { installDocumentTitle } from './appState/documentTitle'
import {
  paramsPatchFromUwpDigits,
  setParamsSnapshot,
  params,
  uwp,
} from './appState'
import { installSubsectorPipeline } from './subsectorClient'
import './styles.css'

publishBuildId()
installServiceWorkerAutoReload()
// Order matters: hydrate signals from storage BEFORE the App mounts so the
// first render already reflects the user's last session, then start the
// effect that mirrors future signal writes back to storage.
loadPersistedPreferences()
loadUrlState()
loadPersistedSubsectorOverrides()
installPreferencePersistence()
installUrlStateMirror()
installSubsectorOverridePersistence()
installDocumentTitle()
// Project the default (or persisted) UWP into the visual params so the
// planet the user sees on first frame matches the UWP code displayed in
// the panel. Without this, population_intensity / sea_level / atmosphere
// stay at their defaults until the user touches a slider - which left
// the Surface map empty of settlements on initial paint.
setParamsSnapshot({ ...params.value, ...paramsPatchFromUwpDigits(uwp.value) })
installSubsectorPipeline()
render(<App />, document.getElementById('app')!)
