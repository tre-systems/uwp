import { render } from 'preact'
import { App } from './app'
import { publishBuildId } from './buildId'
import './styles.css'

publishBuildId()
render(<App />, document.getElementById('app')!)
