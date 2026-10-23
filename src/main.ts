import './style.css'
import json from '#document'
import { parseConditions } from './core/conditions'
import { parseDocument } from './core/document'
import { mount, showErrors } from './browser/render'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('index.html has no #app element')

const parsed = parseDocument(json)
const conditions = parseConditions(location.search)
if (!parsed.ok) showErrors(app, parsed.errors)
else if (!conditions.ok) showErrors(app, conditions.errors, 'This link has errors')
else mount(app, parsed.document, conditions.conditions)
