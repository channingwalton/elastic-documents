import type { ElasticDocument } from '../core/document'
import { toggle, view, type OpenSet, type ViewBlock, type ViewInline } from '../core/view'

/**
 * Draws the document into the container. A closed stretch is a control that
 * opens it; an open stretch is plain text ending in a control that collapses it,
 * so no control ever sits inside another.
 */
export function mount(container: HTMLElement, elastic: ElasticDocument): void {
  let open: OpenSet = new Set()
  // Once a click toggles, the rest of that double- or triple-click lands on whatever the
  // redraw put under the pointer, so it neither toggles nor selects a word.
  let clickToggled = false

  const draw = (): void => {
    container.replaceChildren(element('h1', elastic.title), ...view(elastic, open).map(paragraph))
  }

  const toggleAt = (target: EventTarget | null, byClick: boolean): boolean => {
    const id = controlAt(target)?.dataset.toggle
    if (id === undefined) return false
    const opening = !open.has(id)
    open = toggle(open, id)
    draw()
    // Opening by click keeps the text still under the pointer; otherwise bring the phrase into view.
    findStretch(container, id)?.focus({ preventScroll: byClick && opening })
    return true
  }

  container.addEventListener('mousedown', (event) => {
    if (event.detail > 1 && clickToggled) event.preventDefault()
  })
  container.addEventListener('click', (event) => {
    if (event.detail > 1 && clickToggled) return
    clickToggled = !endsSelectionAcross(event.target) && toggleAt(event.target, true)
  })
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.repeat ? isControl(event.target) : toggleAt(event.target, false)) event.preventDefault()
  })
  draw()
}

function controlAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-toggle]') : null
}

/** A held key repeats; only its first press toggles, but none may scroll the page. */
function isControl(target: EventTarget | null): boolean {
  return controlAt(target) !== null
}

/** The click that ends a drag-select across a control is the reader selecting text, not toggling. */
function endsSelectionAcross(target: EventTarget | null): boolean {
  const control = controlAt(target)
  const selection = getSelection()
  if (control === null || selection === null || selection.isCollapsed) return false
  return Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some((range) =>
    range.intersectsNode(control),
  )
}

export function showErrors(container: HTMLElement, errors: readonly string[]): void {
  const list = document.createElement('ul')
  list.append(...errors.map((error) => element('li', error)))
  container.replaceChildren(element('h1', 'This document has errors'), list)
}

function paragraph(block: ViewBlock): HTMLElement {
  const p = document.createElement('p')
  p.append(...block.map((inline) => node(inline, 0)))
  return p
}

/** `depth` counts the open stretches around this one, so nested shades alternate. */
function node(inline: ViewInline, depth: number): Node {
  if (inline.kind === 'text') return document.createTextNode(inline.text)

  const span = document.createElement('span')
  span.dataset.stretch = inline.id
  if (inline.open) {
    span.className = `stretch open ${depth % 2 === 0 ? 'shade-1' : 'shade-2'}`
    span.tabIndex = -1
    span.setAttribute('role', 'group')
    span.setAttribute('aria-label', `Expanded: ${inline.short}`)
    span.append(...inline.inlines.map((child) => node(child, depth + 1)), collapseControl(inline.id, inline.short))
  } else {
    span.className = 'stretch'
    span.textContent = inline.text
    makeControl(span, inline.id, false)
  }
  return span
}

/** Empty, so its glyph (drawn by CSS) stays out of the text and out of copied text. */
function collapseControl(id: string, short: string): HTMLElement {
  const control = document.createElement('span')
  control.className = 'collapse'
  control.setAttribute('aria-label', `Collapse: ${short}`)
  makeControl(control, id, true)
  return control
}

function makeControl(control: HTMLElement, id: string, expanded: boolean): void {
  control.dataset.toggle = id
  control.tabIndex = 0
  control.setAttribute('role', 'button')
  control.setAttribute('aria-expanded', String(expanded))
}

function findStretch(container: HTMLElement, id: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[data-stretch]')].find((el) => el.dataset.stretch === id)
}

function element(tag: string, text: string): HTMLElement {
  const el = document.createElement(tag)
  el.textContent = text
  return el
}
