import './style.css'
import json from '#document'
import { parseDocument } from './core/document'
import { mount, showErrors } from './browser/render'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('index.html has no #app element')

const parsed = parseDocument(json)
if (parsed.ok) mount(app, parsed.document)
else showErrors(app, parsed.errors)
