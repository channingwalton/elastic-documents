import {
  isOperation,
  operationInfo,
  provenanceLabel,
  provenances,
  type ElasticDocument,
  type Operation,
  type Passage,
  type Provenance,
} from '../core/document'
import { createReader, type Depth, type FocusTarget, type Intent, type Marking } from '../core/reader'
import type { Chip, ViewAttachment, ViewBlock, ViewInline } from '../core/view'

/**
 * Draws the document into the container and forwards the reader's clicks and
 * keys to the core as intents. A closed phrase is a control; its operation
 * buttons sit beside it and an elaborated phrase ends with them, so no control
 * ever sits inside another. The depth control and the provenance switch sit
 * beneath the title.
 */
export function mount(container: HTMLElement, elastic: ElasticDocument): void {
  const reader = createReader(elastic)
  // Once a click acts, the rest of that double- or triple-click lands on whatever the
  // redraw put under the pointer, so it neither acts nor selects a word.
  let clickActed = false

  const draw = (): void => {
    container.replaceChildren(
      element('h1', elastic.title),
      ...depthControl(reader.depth()),
      ...provenanceControl(reader.marking()),
      ...reader.view().flatMap(renderBlock),
    )
  }

  const dispatchAt = (target: EventTarget | null, byClick: boolean): boolean => {
    const intent = intentOf(controlAt(target))
    const effect = intent && reader.dispatch(intent)
    if (!effect) return false
    draw()
    findFocusTarget(container, effect.focus)?.focus({ preventScroll: byClick && effect.keepStill })
    return true
  }

  container.addEventListener('mousedown', (event) => {
    if (event.detail > 1 && clickActed) event.preventDefault()
  })
  container.addEventListener('click', (event) => {
    if (event.detail > 1 && clickActed) return
    clickActed = !endsSelectionAcross(event.target) && dispatchAt(event.target, true)
    // Focus inside opened text shows its buttons, which is how a touch screen, without hover, reaches them.
    if (!isControl(event.target)) openedTextAt(event.target)?.focus({ preventScroll: true })
  })
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.repeat ? isControl(event.target) : dispatchAt(event.target, false)) event.preventDefault()
  })
  draw()
}

function controlAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-activate], [data-toggle], [data-depth], [data-provenance]')
    : null
}

function intentOf(control: HTMLElement | null): Intent | undefined {
  const { activate, toggle, operation, depth, provenance } = control?.dataset ?? {}
  if (activate !== undefined) return { kind: 'activate', id: activate }
  if (toggle !== undefined && isOperation(operation)) return { kind: 'toggle', id: toggle, operation }
  if (depth !== undefined) return { kind: 'depth', depth: Number(depth) }
  if (provenance !== undefined) return { kind: 'provenance' }
  return undefined
}

/** A held key repeats; only its first press acts, but none may scroll the page. */
function isControl(target: EventTarget | null): boolean {
  return controlAt(target) !== null
}

/** The innermost elaborated text around the target. */
function openedTextAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.stretch.open') : null
}

/** The click that ends a drag-select across a control is the reader selecting text, not acting. */
function endsSelectionAcross(target: EventTarget | null): boolean {
  const control = controlAt(target)
  const selection = getSelection()
  if (control === null || selection === null || selection.isCollapsed) return false
  return Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some((range) =>
    range.intersectsNode(control),
  )
}

function findFocusTarget(container: HTMLElement, focus: FocusTarget): HTMLElement | null {
  const byId = (id: string) => container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  switch (focus.kind) {
    case 'phrase':
      return byId(elementId.phrase(focus.id))
    case 'long':
      return byId(elementId.revealed(focus.id, 'elaborate'))
    case 'attachment':
      return byId(elementId.revealed(focus.id, focus.operation))
    case 'chip':
      return byId(elementId.chip(focus.id, focus.operation))
    case 'depth':
      return byId(elementId.depth(focus.depth))
    case 'provenance':
      return byId(elementId.provenance)
  }
}

export function showErrors(container: HTMLElement, errors: readonly string[]): void {
  const list = document.createElement('ul')
  list.append(...errors.map((error) => element('li', error)))
  container.replaceChildren(element('h1', 'This document has errors'), list)
}

/** A button for each depth, from the short forms down to the deepest Elaborate; none if nothing elaborates. */
function depthControl({ current, deepest }: Depth): HTMLElement[] {
  if (deepest === 0) return []
  const group = document.createElement('div')
  group.className = 'depth'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', 'Depth')
  const label = element('span', 'Depth', 'depth-label')
  label.setAttribute('aria-hidden', 'true')
  const buttons = Array.from({ length: deepest + 1 }, (_, depth) => {
    const button = element('span', String(depth))
    button.id = elementId.depth(depth)
    button.dataset.depth = String(depth)
    button.title = depth === 0 ? 'Show the short forms' : `Open phrases ${depth} ${depth === 1 ? 'level' : 'levels'} deep`
    makeControl(button)
    button.setAttribute('aria-pressed', String(depth === current))
    return button
  })
  group.append(label, ...buttons)
  return [group]
}

/** A switch that shows or hides provenance, with a legend while it shows; none if every level is approved. */
function provenanceControl({ shown, needed }: Marking): HTMLElement[] {
  if (!needed) return []
  const row = document.createElement('div')
  row.className = 'provenance'
  const toggle = element('span', 'Provenance')
  toggle.id = elementId.provenance
  toggle.dataset.provenance = ''
  toggle.title = `${shown ? 'Hide' : 'Show'} where the text came from`
  makeControl(toggle)
  toggle.setAttribute('aria-pressed', String(shown))
  row.append(toggle)
  if (shown) row.append(legend())
  return [row]
}

/** Each provenance in its own style, after its mark. The marks are hidden from screen readers, which hear the names. */
function legend(): HTMLElement {
  const list = document.createElement('span')
  list.className = 'provenance-legend'
  list.append(
    ...provenances.map((provenance) => {
      const mark = provenanceMark(provenance)
      mark.setAttribute('aria-hidden', 'true')
      const item = element('span', provenanceLabel[provenance], provenanceClass(provenance))
      item.prepend(mark)
      return item
    }),
  )
  return list
}

/** Styles an element after its provenance, when it has one, and returns the mark to put before its text. */
function marks(level: HTMLElement, provenance: Provenance | undefined): HTMLElement[] {
  if (provenance === undefined) return []
  level.classList.add(provenanceClass(provenance))
  const mark = provenanceMark(provenance)
  mark.setAttribute('role', 'img')
  nameGlyph(mark, provenanceLabel[provenance])
  return [mark]
}

/** Empty, with its glyph drawn by CSS, so it stays out of the prose and out of copied text. */
function provenanceMark(provenance: Provenance): HTMLElement {
  const mark = document.createElement('span')
  mark.className = `provenance-mark ${provenanceClass(provenance)}`
  return mark
}

const provenanceClass = (provenance: Provenance): string => `provenance-${provenance}`

/** A block is a paragraph followed by the content its phrases have opened beneath it. */
function renderBlock(block: ViewBlock): Node[] {
  const p = document.createElement('p')
  p.append(...marks(p, block.provenance), ...block.inlines.flatMap((inline) => renderInline(inline, 0)))
  return [p, ...block.attachments.map(renderAttachment)]
}

/** `depth` counts the elaborated phrases around this one, so nested shades alternate. */
function renderInline(inline: ViewInline, depth: number): Node[] {
  if (inline.kind === 'text') return [document.createTextNode(inline.text)]

  if (inline.kind === 'phrase') {
    const phrase = document.createElement('span')
    phrase.className = 'stretch'
    phrase.id = elementId.phrase(inline.id)
    phrase.dataset.activate = inline.id
    phrase.textContent = inline.text
    makeControl(phrase)
    phrase.setAttribute('aria-expanded', String(inline.chips.length > 0))
    const marked = [...marks(phrase, inline.provenance), phrase]
    if (inline.chips.length === 0) return marked
    const opened = inline.chips.flatMap((chip) => revealedOutside(inline.id, chip) ?? [])
    phrase.setAttribute('aria-controls', [elementId.chips(inline.id), ...opened].join(' '))
    return [...marked, chipRow(inline.id, inline.text, inline.chips)]
  }

  const long = document.createElement('span')
  long.className = `stretch open ${depth % 2 === 0 ? 'shade-1' : 'shade-2'}`
  long.id = elementId.revealed(inline.id, 'elaborate')
  long.tabIndex = -1
  long.setAttribute('role', 'group')
  long.setAttribute('aria-label', `Expanded: ${inline.short}`)
  const buttons = chipRow(inline.id, inline.short, inline.chips)
  // The stylesheet keeps these out of sight until the reader attends to the phrase.
  buttons.classList.add('quiet')
  long.append(
    ...marks(long, inline.provenance),
    ...inline.inlines.flatMap((child) => renderInline(child, depth + 1)),
    buttons,
  )
  return [long]
}

function chipRow(id: string, short: string, chips: readonly Chip[]): HTMLElement {
  const row = document.createElement('span')
  row.className = 'chips'
  row.id = elementId.chips(id)
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', `Operations: ${short}`)
  row.append(...chips.map((chip) => (chip.kind === 'collapse' ? collapseControl(id, short) : chipControl(id, chip))))
  return row
}

/** Empty, with its glyph drawn by CSS, so it stays out of the prose and out of copied text. */
function collapseControl(id: string, short: string): HTMLElement {
  const control = operationControl(id, 'elaborate')
  control.className = 'collapse'
  nameGlyph(control, `Collapse: ${short}`)
  control.setAttribute('aria-expanded', 'true')
  return control
}

/** Empty, with its label drawn by CSS, for the same reason. */
function chipControl(id: string, chip: Extract<Chip, { kind: 'toggle' }>): HTMLElement {
  const { label: name, purpose } = operationInfo[chip.operation]
  const [shown, spoken] =
    chip.count === undefined ? [name, name] : [`${name} ·${chip.count}`, `${name}, ${chip.count}`]
  const control = operationControl(id, chip.operation)
  control.id = elementId.chip(id, chip.operation)
  control.className = 'chip'
  control.dataset.label = shown
  control.title = purpose
  control.setAttribute('aria-label', spoken)
  control.setAttribute('aria-pressed', String(chip.pressed))
  const revealed = revealedOutside(id, chip)
  if (revealed !== undefined) control.setAttribute('aria-controls', revealed)
  return control
}

/**
 * What a pressed button opened outside itself, for aria-controls. Elaborate's
 * button sits inside the text it opened, so it names nothing.
 */
function revealedOutside(id: string, chip: Chip): string | undefined {
  return chip.kind === 'toggle' && chip.pressed && chip.operation !== 'elaborate'
    ? elementId.revealed(id, chip.operation)
    : undefined
}

/** A control that toggles one operation on a phrase. */
function operationControl(id: string, operation: Operation): HTMLElement {
  const control = document.createElement('span')
  control.dataset.toggle = id
  control.dataset.operation = operation
  makeControl(control)
  return control
}

/** For a control drawn only as a glyph: its tooltip is its name, so screen readers say it once. */
function nameGlyph(control: HTMLElement, name: string): void {
  control.setAttribute('aria-label', name)
  control.title = name
}

function renderAttachment(attachment: ViewAttachment): HTMLElement {
  const name = operationInfo[attachment.operation].label
  const box = document.createElement('div')
  box.className = `attachment op-${attachment.operation}`
  box.id = elementId.revealed(attachment.id, attachment.operation)
  box.tabIndex = -1
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', `${name}: ${attachment.short}`)

  const close = operationControl(attachment.id, attachment.operation)
  close.className = 'close'
  nameGlyph(close, `Close ${name}: ${attachment.short}`)

  const header = document.createElement('div')
  header.className = 'attachment-header'
  header.append(element('span', name, 'attachment-operation'), element('span', attachment.short, 'attachment-phrase'), close)

  box.append(header, ...(attachment.kind === 'passages' ? attachment.passages.map(quotation) : attachment.blocks.flatMap(renderBlock)))
  return box
}

function quotation(passage: Passage): HTMLElement {
  const footer = document.createElement('footer')
  footer.append(element('cite', passage.note), ...(passage.date === undefined ? [] : [` · ${passage.date}`]))
  const quote = document.createElement('blockquote')
  quote.append(element('p', passage.quote), footer)
  return quote
}

/** The ids of what a document draws, so controls can name what they reveal and focus can find it. */
export const elementId = {
  phrase: (id: string): string => `elastic-phrase-${id}`,
  chips: (id: string): string => `elastic-chips-${id}`,
  chip: (id: string, operation: Operation): string => `elastic-chip-${operation}-${id}`,
  /** The elaborated text for Elaborate; the content opened beneath for the others. */
  revealed: (id: string, operation: Operation): string => `elastic-${operation}-${id}`,
  depth: (depth: number): string => `elastic-depth-${depth}`,
  provenance: 'elastic-provenance',
}

function makeControl(control: HTMLElement): void {
  control.tabIndex = 0
  control.setAttribute('role', 'button')
}

function element(tag: string, text: string, className?: string): HTMLElement {
  const el = document.createElement(tag)
  el.textContent = text
  if (className !== undefined) el.className = className
  return el
}
