import { render } from 'preact'
import { App } from './app'
import { installServiceWorkerAutoReload, publishBuildId } from './buildId'
import './styles.css'

publishBuildId()
installServiceWorkerAutoReload()
render(<App />, document.getElementById('app')!)
