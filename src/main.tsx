import { render } from 'preact'
import { App } from './app'
import { installServiceWorkerAutoReload, publishBuildId } from './buildId'
import {
  installPreferencePersistence,
  loadPersistedPreferences,
} from './appState/persistence'
import { installSubsectorPipeline } from './subsectorClient'
import './styles.css'

publishBuildId()
installServiceWorkerAutoReload()
// Order matters: hydrate signals from storage BEFORE the App mounts so the
// first render already reflects the user's last session, then start the
// effect that mirrors future signal writes back to storage.
loadPersistedPreferences()
installPreferencePersistence()
installSubsectorPipeline()
render(<App />, document.getElementById('app')!)
