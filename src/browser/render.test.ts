// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConditions, type Conditions } from '../core/conditions'
import type { Operation } from '../core/document'
import { documentFrom, testDocument } from '../core/testing'
import { elementId, mount, showErrors } from './render'

const nested = documentFrom({
  title: 'T',
  blocks: [
    [
      'A document ',
      {
        id: 'outer',
        short: 'the reader stretches',
        elaborate: ['the reader stretches ', { id: 'inner', short: 'and shrinks', elaborate: ['and shrinks in place'] }],
      },
      '.',
    ],
    ['A second paragraph.'],
  ],
})

function byId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
}

/** A phrase, or its elaborated text when it is open. */
function stretch(container: HTMLElement, id: string): HTMLElement {
  const element = byId(container, elementId.phrase(id)) ?? byId(container, elementId.revealed(id, 'elaborate'))
  if (!element) throw new Error(`no stretch ${id}`)
  return element
}

/** The control that opens a closed phrase, or collapses an elaborated one. */
function control(container: HTMLElement, id: string): HTMLElement {
  const element =
    container.querySelector<HTMLElement>(`[data-activate="${id}"]`) ??
    container.querySelector<HTMLElement>(`[data-toggle="${id}"][data-operation="elaborate"]`)
  if (!element) throw new Error(`no control for ${id}`)
  return element
}

/** The button for one operation on a phrase, in the row beside it. */
function chip(container: HTMLElement, id: string, operation: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`.chips [data-toggle="${id}"][data-operation="${operation}"]`)
  if (!element) throw new Error(`no ${operation} chip for ${id}`)
  return element
}

function attachment(container: HTMLElement, id: string, operation: Operation): HTMLElement | null {
  return byId(container, elementId.revealed(id, operation))
}

function firstParagraph(container: HTMLElement): string {
  return container.querySelector('p')?.textContent ?? ''
}

/** `detail` is the click count: 2 for the second click of a double-click. */
function click(target: HTMLElement, detail: number): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('mount', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, nested)
  })

  it('renders the title as a heading', () => {
    expect(container.querySelector('h1')?.textContent).toBe('T')
  })

  it('renders each block as a paragraph showing short forms', () => {
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'A document the reader stretches.',
      'A second paragraph.',
    ])
    expect(control(container, 'outer').getAttribute('aria-expanded')).toBe('false')
  })

  it('expands a stretch in place when clicked, and collapses it from its collapse control', () => {
    control(container, 'outer').click()
    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
    expect(control(container, 'outer').getAttribute('aria-expanded')).toBe('true')

    control(container, 'outer').click()
    expect(firstParagraph(container)).toBe('A document the reader stretches.')
  })

  it('never puts one control inside another', () => {
    control(container, 'outer').click()

    expect(container.querySelectorAll('[role="button"] [role="button"]')).toHaveLength(0)
    expect(stretch(container, 'outer').getAttribute('role')).not.toBe('button')
  })

  it('leaves an open stretch open when its text is clicked', () => {
    control(container, 'outer').click()
    stretch(container, 'outer').click()

    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
  })

  it('focuses the innermost open stretch when its text is clicked, so a touch screen can show its buttons', () => {
    control(container, 'outer').click()
    control(container, 'inner').click()
    ;(document.activeElement as HTMLElement).blur()
    stretch(container, 'inner').click()

    expect(document.activeElement).toBe(stretch(container, 'inner'))
  })

  it('quiets only an elaborated phrase’s own buttons, not those of a closed phrase inside it', () => {
    const container = document.createElement('div')
    mount(
      container,
      documentFrom({
        title: 'T',
        blocks: [
          [{ id: 'outer', short: 'outer', elaborate: ['outer ', { id: 'inner', short: 'inner', elaborate: ['inner'], challenge: ['c'] }] }],
        ],
      }),
    )
    control(container, 'outer').click()
    control(container, 'inner').click()

    expect([...container.querySelectorAll('.chips')].map((row) => [row.id, row.classList.contains('quiet')])).toEqual([
      [elementId.chips('inner'), false],
      [elementId.chips('outer'), true],
    ])
  })

  it('expands a nested stretch without collapsing its parent', () => {
    control(container, 'outer').click()
    control(container, 'inner').click()

    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks in place.')
  })

  it('collapses a parent whose long form is only a child stretch', () => {
    const container = document.createElement('div')
    mount(
      container,
      documentFrom({
        title: 'T',
        blocks: [[{ id: 'parent', short: 'parent', elaborate: [{ id: 'child', short: 'child', elaborate: ['child'] }] }]],
      }),
    )
    control(container, 'parent').click()
    control(container, 'parent').click()

    expect(firstParagraph(container)).toBe('parent')
  })

  function select(range: Range): void {
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  }

  it('ignores the click that ends a text selection across the control', () => {
    const text = container.querySelector('p')?.firstChild
    const phrase = control(container, 'outer').firstChild
    if (!text || !phrase) throw new Error('no text')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(phrase, 3)
    select(range)

    control(container, 'outer').click()

    expect(firstParagraph(container)).toBe('A document the reader stretches.')
    getSelection()?.removeAllRanges()
  })

  it('leaves focus on a control inside opened text when the click ends a selection across it', () => {
    control(container, 'outer').click()
    const inner = control(container, 'inner')
    inner.focus()
    const range = document.createRange()
    range.selectNodeContents(inner)
    select(range)

    inner.click()

    expect(document.activeElement).toBe(inner)
    getSelection()?.removeAllRanges()
  })

  it('opens a stretch while unrelated text is selected', () => {
    const range = document.createRange()
    range.selectNodeContents(container.querySelectorAll('p')[1] as Node)
    select(range)

    control(container, 'outer').click()

    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
    getSelection()?.removeAllRanges()
  })

  describe('a double- or triple-click', () => {
    /** The long form starts with a nested stretch, so a second click lands on it. */
    function mountStartingWithStretch(): HTMLElement {
      const container = document.createElement('div')
      mount(
        container,
        documentFrom({
          title: 'T',
          blocks: [
            [{ id: 'outer', short: 'word', elaborate: [{ id: 'inner', short: 'word', elaborate: ['word inside'] }, ' after'] }],
          ],
        }),
      )
      return container
    }

    function mousedown(target: HTMLElement, detail: number): MouseEvent {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail })
      target.dispatchEvent(event)
      return event
    }

    it('opens a stretch once, ignoring the clicks that land on what the first click revealed', () => {
      const container = mountStartingWithStretch()
      click(control(container, 'outer'), 1)
      click(control(container, 'inner'), 2)
      expect(firstParagraph(container)).toBe('word after')

      click(control(container, 'inner'), 3)
      expect(firstParagraph(container)).toBe('word after')
    })

    it('collapses a stretch once, ignoring the click that lands on what the collapse moved under the pointer', () => {
      const container = mountStartingWithStretch()
      control(container, 'outer').click()
      click(control(container, 'outer'), 1)
      click(control(container, 'outer'), 2)

      expect(firstParagraph(container)).toBe('word')
    })

    it('acts on a second click when the first click toggled nothing', () => {
      const container = mountStartingWithStretch()
      click(container.querySelector('h1') as HTMLElement, 1)
      click(control(container, 'outer'), 2)

      expect(firstParagraph(container)).toBe('word after')
    })

    it('stops the second press selecting a word only when the first click toggled', () => {
      const container = mountStartingWithStretch()
      click(control(container, 'outer'), 1)
      expect(mousedown(stretch(container, 'outer'), 2).defaultPrevented).toBe(true)

      const heading = container.querySelector('h1') as HTMLElement
      click(heading, 1)
      expect(mousedown(heading, 2).defaultPrevented).toBe(false)
    })
  })

  it('keeps the page still when a click opens a stretch, and brings the phrase into view otherwise', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const lastFocus = () => ({ element: focus.mock.contexts.at(-1), options: focus.mock.lastCall?.[0] })

    try {
      control(container, 'outer').click()
      expect(lastFocus()).toEqual({ element: stretch(container, 'outer'), options: { preventScroll: true } })

      control(container, 'outer').click()
      expect(lastFocus()).toEqual({ element: control(container, 'outer'), options: { preventScroll: false } })

      press(control(container, 'outer'), 'Enter')
      expect(lastFocus()).toEqual({ element: stretch(container, 'outer'), options: { preventScroll: false } })

      press(control(container, 'outer'), 'Enter')
      expect(lastFocus()).toEqual({ element: control(container, 'outer'), options: { preventScroll: false } })
    } finally {
      focus.mockRestore()
    }
  })

  it('alternates the shade of open stretches at every depth', () => {
    const container = document.createElement('div')
    mount(
      container,
      documentFrom({
        title: 'T',
        blocks: [
          [
            {
              id: 'one',
              short: 'one',
              elaborate: [
                'one ',
                { id: 'two', short: 'two', elaborate: ['two ', { id: 'three', short: 'three', elaborate: ['three'] }] },
              ],
            },
          ],
        ],
      }),
    )
    for (const id of ['one', 'two', 'three']) control(container, id).click()

    expect(['one', 'two', 'three'].map((id) => stretch(container, id).classList.contains('shade-2'))).toEqual([
      false,
      true,
      false,
    ])
  })

  it('toggles a focused control with Enter or Space', () => {
    press(control(container, 'outer'), 'Enter')
    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')

    press(control(container, 'outer'), ' ')
    expect(firstParagraph(container)).toBe('A document the reader stretches.')
  })

  it('toggles once while a key is held, without letting it scroll the page', () => {
    expect(press(control(container, 'outer'), ' ').defaultPrevented).toBe(true)
    expect(press(control(container, 'outer'), ' ', { repeat: true }).defaultPrevented).toBe(true)
    expect(press(control(container, 'outer'), 'Enter', { repeat: true }).defaultPrevented).toBe(true)

    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
  })

  it('names each collapse control after its stretch', () => {
    control(container, 'outer').click()
    control(container, 'inner').click()

    expect([...container.querySelectorAll('.collapse')].map((c) => c.getAttribute('aria-label'))).toEqual([
      'Collapse: and shrinks',
      'Collapse: the reader stretches',
    ])
    expect([...container.querySelectorAll<HTMLElement>('.collapse')].map((c) => c.title)).toEqual([
      'Collapse: and shrinks',
      'Collapse: the reader stretches',
    ])
  })

  it('ignores keys with modifiers', () => {
    expect(press(control(container, 'outer'), ' ', { shiftKey: true }).defaultPrevented).toBe(false)
    expect(press(control(container, 'outer'), 'Enter', { metaKey: true }).defaultPrevented).toBe(false)
    expect(press(control(container, 'outer'), 'Enter', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(control(container, 'outer'), 'Enter', { altKey: true }).defaultPrevented).toBe(false)

    expect(firstParagraph(container)).toBe('A document the reader stretches.')
  })

  it('leaves Enter and Space alone outside a control', () => {
    const paragraph = container.querySelector('p')
    if (!paragraph) throw new Error('no paragraph')

    expect(press(paragraph, 'Enter').defaultPrevented).toBe(false)
    expect(press(paragraph, ' ').defaultPrevented).toBe(false)
  })

  it('moves focus to the opened text, then back to the phrase when it collapses', () => {
    press(control(container, 'outer'), 'Enter')
    expect(document.activeElement).toBe(stretch(container, 'outer'))
    expect(document.activeElement?.getAttribute('role')).toBe('group')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Expanded: the reader stretches')

    press(control(container, 'outer'), 'Enter')
    expect(document.activeElement).toBe(control(container, 'outer'))
  })
})

describe('mount with several operations', () => {
  const rich = documentFrom({
    title: 'T',
    blocks: [
      [
        'The idea is ',
        {
          id: 'idea',
          short: 'stretchtext',
          elaborate: ['stretchtext, from 1967'],
          ground: [
            { note: 'Stretchtext', date: '2026-10-19', quote: 'the reader remains oriented' },
            { note: 'Elastic Documents', quote: 'A summary opens into its detail.' },
          ],
          challenge: ['An objection.'],
          exemplify: [['An example with ', { id: 'deep', short: 'a source', ground: [{ note: 'N', quote: 'Q' }] }, '.']],
        },
        '.',
      ],
      ['A second paragraph.'],
    ],
  })

  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, rich)
  })

  function chipLabels(): (string | null)[][] {
    return [...container.querySelectorAll('.chips [data-operation]')].map((c) => [
      c.getAttribute('aria-label'),
      c.getAttribute('aria-pressed'),
    ])
  }

  it('shows a button for each operation the phrase has, with counts, keeping them out of the text', () => {
    control(container, 'idea').click()

    expect(chipLabels()).toEqual([
      ['Elaborate', 'false'],
      ['Ground, 2', 'false'],
      ['Exemplify, 1', 'false'],
      ['Challenge, 1', 'false'],
    ])
    expect([...container.querySelectorAll<HTMLElement>('.chips .chip')].map((c) => c.title)).toEqual([
      'Add detail',
      'Reveal the sources',
      'Make it concrete',
      'Show objections and limits',
    ])
    expect(chip(container, 'idea', 'ground').dataset.label).toBe('Ground ·2')
    expect(control(container, 'idea').getAttribute('aria-expanded')).toBe('true')
    expect(firstParagraph(container)).toBe('The idea is stretchtext.')
  })

  it('moves keyboard focus to the first button, and toggles a button with Enter', () => {
    press(control(container, 'idea'), 'Enter')
    expect(document.activeElement).toBe(chip(container, 'idea', 'elaborate'))

    press(chip(container, 'idea', 'ground'), 'Enter')
    expect(attachment(container, 'idea', 'ground')).not.toBeNull()
  })

  it('opens Ground beneath the paragraph as quoted passages with their note and date', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'ground').click()

    const ground = attachment(container, 'idea', 'ground')
    expect(ground?.previousElementSibling?.tagName).toBe('P')
    expect(ground?.getAttribute('aria-label')).toBe('Ground: stretchtext')
    expect([...(ground?.querySelectorAll('blockquote') ?? [])].map((q) => q.textContent)).toEqual([
      'the reader remains orientedStretchtext · 2026-10-19',
      'A summary opens into its detail.Elastic Documents',
    ])
    expect(chip(container, 'idea', 'ground').getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(ground)
  })

  it('closes an operation from its close control and returns focus to its button', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'ground').click()
    attachment(container, 'idea', 'ground')?.querySelector<HTMLElement>('.close')?.click()

    expect(attachment(container, 'idea', 'ground')).toBeNull()
    expect(document.activeElement).toBe(chip(container, 'idea', 'ground'))
  })

  it('opens a list operation as paragraphs whose phrases open in turn, beneath their own paragraph', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'exemplify').click()
    control(container, 'deep').click()

    const exemplify = attachment(container, 'idea', 'exemplify')
    expect(exemplify?.querySelector('p')?.textContent).toBe('An example with a source.')
    expect(attachment(container, 'deep', 'ground')?.parentElement).toBe(exemplify)
    expect(attachment(container, 'deep', 'ground')?.previousElementSibling?.tagName).toBe('P')
  })

  it('elaborates from its button, which stays a pressed button beside the others and collapses it again', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'elaborate').click()

    expect(firstParagraph(container)).toBe('The idea is stretchtext, from 1967.')
    expect(stretch(container, 'idea').querySelector('.chips')).not.toBeNull()
    expect(chipLabels()).toEqual([
      ['Elaborate', 'true'],
      ['Ground, 2', 'false'],
      ['Exemplify, 1', 'false'],
      ['Challenge, 1', 'false'],
    ])

    chip(container, 'idea', 'elaborate').click()
    expect(firstParagraph(container)).toBe('The idea is stretchtext.')
  })

  /** The elements an aria-controls attribute names, each looked up by its id; fails if one is missing. */
  function controlled(element: Element): Element[] {
    return (element.getAttribute('aria-controls') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => {
        const found = document.getElementById(id)
        if (!found) throw new Error(`aria-controls names a missing element: ${id}`)
        return found
      })
  }

  it('links the phrase to its buttons and what it opened, and a pressed button to its content', () => {
    control(container, 'idea').click()
    expect(controlled(control(container, 'idea'))).toEqual([container.querySelector('.chips')])
    expect(chip(container, 'idea', 'ground').hasAttribute('aria-controls')).toBe(false)

    chip(container, 'idea', 'ground').click()
    const ground = attachment(container, 'idea', 'ground')
    expect(controlled(chip(container, 'idea', 'ground'))).toEqual([ground])
    expect(controlled(control(container, 'idea'))).toEqual([container.querySelector('.chips'), ground])
  })

  it('does not link a control to the element it sits inside', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'elaborate').click()
    chip(container, 'idea', 'ground').click()
    expect(chip(container, 'idea', 'elaborate').hasAttribute('aria-controls')).toBe(false)
    expect(attachment(container, 'idea', 'ground')?.querySelector('.close')?.hasAttribute('aria-controls')).toBe(false)

    const single = document.createElement('div')
    document.body.replaceChildren(single)
    mount(single, nested)
    control(single, 'outer').click()
    const collapse = single.querySelector('.collapse')
    expect(collapse?.getAttribute('aria-label')).toBe('Collapse: the reader stretches')
    expect(collapse?.hasAttribute('aria-controls')).toBe(false)
  })

  it('gives every element a unique id, including inside content opened beneath', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'exemplify').click()
    chip(container, 'idea', 'ground').click()
    chip(container, 'idea', 'elaborate').click()
    control(container, 'deep').click()

    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids).toContain(elementId.revealed('idea', 'elaborate'))
    expect(new Set(ids).size).toBe(ids.length)
    expect(controlled(control(container, 'deep'))).toEqual([
      attachment(container, 'idea', 'exemplify')?.querySelector('.chips'),
      attachment(container, 'deep', 'ground'),
    ])
  })

  it('returns keyboard focus to the Elaborate button, now unpressed, when it collapses the phrase', () => {
    control(container, 'idea').click()
    press(chip(container, 'idea', 'elaborate'), 'Enter')
    press(chip(container, 'idea', 'elaborate'), 'Enter')

    expect(document.activeElement).toBe(chip(container, 'idea', 'elaborate'))
    expect(chip(container, 'idea', 'elaborate').getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a lone operation other than Elaborate as a pressed button, not a collapse control', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'exemplify').click()
    control(container, 'deep').click()

    const row = attachment(container, 'idea', 'exemplify')?.querySelector('.chips')
    expect(row?.querySelector('.collapse')).toBeNull()
    expect(chip(container, 'deep', 'ground').getAttribute('aria-pressed')).toBe('true')
  })

  it('gives the close control a tooltip that matches its name', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'ground').click()
    const close = attachment(container, 'idea', 'ground')?.querySelector<HTMLElement>('.close')

    expect(close?.getAttribute('aria-label')).toBe('Close Ground: stretchtext')
    expect(close?.title).toBe('Close Ground: stretchtext')
  })

  it('closes everything on a phrase when the phrase is clicked with something open', () => {
    control(container, 'idea').click()
    chip(container, 'idea', 'challenge').click()
    control(container, 'idea').click()

    expect(attachment(container, 'idea', 'challenge')).toBeNull()
    expect(container.querySelector('.chips')).toBeNull()
  })
})

describe('the depth control', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, nested)
  })

  function depthButton(depth: number): HTMLElement {
    const element = byId(container, elementId.depth(depth))
    if (!element) throw new Error(`no depth button ${depth}`)
    return element
  }

  function pressedDepths(): (string | null)[][] {
    return [...container.querySelectorAll('.depth [data-depth]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])
  }

  it('offers each depth from 0 to the deepest beneath the title, with 0 pressed', () => {
    const group = container.querySelector('h1')?.nextElementSibling
    expect(group?.getAttribute('role')).toBe('group')
    expect(group?.getAttribute('aria-label')).toBe('Depth')
    expect(pressedDepths()).toEqual([
      ['0', 'true'],
      ['1', 'false'],
      ['2', 'false'],
    ])
    expect([0, 1, 2].map((depth) => depthButton(depth).title)).toEqual([
      'Show the short forms',
      'Open phrases 1 level deep',
      'Open phrases 2 levels deep',
    ])
  })

  it('opens every phrase to the depth clicked, keeping focus on its button and the page still', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      depthButton(2).click()

      expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks in place.')
      expect(pressedDepths().map(([, pressed]) => pressed)).toEqual(['false', 'false', 'true'])
      expect(document.activeElement).toBe(depthButton(2))
      expect(focus.mock.lastCall?.[0]).toEqual({ preventScroll: true })
    } finally {
      focus.mockRestore()
    }
  })

  it('sets the depth from the keyboard', () => {
    expect(press(depthButton(1), 'Enter').defaultPrevented).toBe(true)
    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
    expect(document.activeElement).toBe(depthButton(1))

    expect(press(depthButton(0), ' ').defaultPrevented).toBe(true)
    expect(firstParagraph(container)).toBe('A document the reader stretches.')
  })

  it('presses no depth while the page has drifted from every depth, until one is clicked', () => {
    depthButton(2).click()
    control(container, 'outer').click()
    expect(firstParagraph(container)).toBe('A document the reader stretches.')
    expect(pressedDepths().map(([, pressed]) => pressed)).toEqual(['false', 'false', 'false'])

    depthButton(0).click()
    expect(pressedDepths().map(([, pressed]) => pressed)).toEqual(['true', 'false', 'false'])
    control(container, 'outer').click()
    expect(firstParagraph(container)).toBe('A document the reader stretches and shrinks.')
    expect(pressedDepths().map(([, pressed]) => pressed)).toEqual(['false', 'true', 'false'])
  })

  it('shows no depth control when nothing in the document elaborates', () => {
    const plain = document.createElement('div')
    mount(plain, documentFrom({ title: 'T', blocks: [[{ id: 'a', short: 'a', ground: [{ note: 'n', quote: 'q' }] }]] }))

    expect(plain.querySelector('.depth')).toBeNull()
  })
})

describe('provenance marking', () => {
  const marked = documentFrom({
    title: 'T',
    blocks: [
      [
        'The idea is ',
        {
          id: 'idea',
          short: { provenance: 'compression', text: 'stretchtext' },
          elaborate: ['stretchtext, from 1967'],
          challenge: ['An objection.'],
        },
        '.',
      ],
      {
        provenance: 'compression',
        inlines: ['A summary of ', { id: 'sum', short: 'the detail', elaborate: { provenance: 'approved', inlines: ['the detail in full'] } }, '.'],
      },
    ],
  })
  const provenanceClasses = '.provenance-approved, .provenance-compression, .provenance-addition'

  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, marked)
  })

  function provenanceSwitch(): HTMLElement {
    const element = byId(container, elementId.provenance)
    if (!element) throw new Error('no provenance switch')
    return element
  }

  /** The name of a mark, which must be drawn only by CSS so it stays out of the text. */
  function markName(mark: Element | null | undefined): string | null | undefined {
    expect(mark?.classList.contains('provenance-mark')).toBe(true)
    expect(mark?.getAttribute('role')).toBe('img')
    expect(mark?.textContent).toBe('')
    return mark?.getAttribute('aria-label')
  }

  function paragraphs(): HTMLParagraphElement[] {
    return [...container.querySelectorAll('p')]
  }

  it('marks a level whose provenance changes with its class and a named mark before it, keeping the text as it was', () => {
    const [idea, summary] = paragraphs()

    expect(paragraphs().map((p) => p.textContent)).toEqual(['The idea is stretchtext.', 'A summary of the detail.'])
    expect(idea?.className).toBe('')
    expect(control(container, 'idea').classList).toContain('provenance-compression')
    expect(markName(control(container, 'idea').previousElementSibling)).toBe('AI compression')
    expect(summary?.className).toBe('provenance-compression')
    expect(markName(summary?.firstElementChild)).toBe('AI compression')
    expect(control(container, 'sum').className).toBe('stretch')
    expect(container.querySelectorAll('p .provenance-mark')).toHaveLength(2)
  })

  it('marks a long form against the text around it, and content opened beneath against the page', () => {
    control(container, 'sum').click()
    control(container, 'idea').click()
    chip(container, 'idea', 'challenge').click()

    expect(stretch(container, 'sum').classList).toContain('provenance-approved')
    expect(markName(stretch(container, 'sum').firstElementChild)).toBe('Approved')
    const objection = attachment(container, 'idea', 'challenge')?.querySelector('p')
    expect(objection?.className).toBe('provenance-addition')
    expect(markName(objection?.firstElementChild)).toBe('AI addition')
  })

  it('hides and shows every mark from a switch beneath the title, keeping focus on it and the page still', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      expect(provenanceSwitch().textContent).toBe('Provenance')
      expect(provenanceSwitch().getAttribute('role')).toBe('button')
      expect(provenanceSwitch().getAttribute('aria-pressed')).toBe('true')

      provenanceSwitch().click()
      expect(provenanceSwitch().getAttribute('aria-pressed')).toBe('false')
      expect(container.querySelectorAll(`.provenance-mark, ${provenanceClasses}`)).toHaveLength(0)
      expect(document.activeElement).toBe(provenanceSwitch())
      expect(focus.mock.lastCall?.[0]).toEqual({ preventScroll: true })

      expect(press(provenanceSwitch(), 'Enter').defaultPrevented).toBe(true)
      expect(provenanceSwitch().getAttribute('aria-pressed')).toBe('true')
      expect(paragraphs()[1]?.className).toBe('provenance-compression')
    } finally {
      focus.mockRestore()
    }
  })

  it('explains each mark beside the switch while they show, without naming them twice to a screen reader', () => {
    const legend = () => [...container.querySelectorAll('.provenance-legend > *')]

    expect(legend().map((item) => [item.className, item.textContent])).toEqual([
      ['provenance-approved', 'Approved'],
      ['provenance-compression', 'AI compression'],
      ['provenance-addition', 'AI addition'],
    ])
    expect(legend().map((item) => item.querySelector('.provenance-mark')?.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true'])

    provenanceSwitch().click()
    expect(legend()).toEqual([])
  })

  it('shows no switch when every level is approved', () => {
    const plain = document.createElement('div')
    mount(plain, nested)

    expect(plain.querySelector(`#${elementId.provenance}, .provenance-legend`)).toBeNull()
  })
})

describe('showErrors', () => {
  it('lists each parse error', () => {
    const container = document.createElement('div')
    showErrors(container, ['title: expected a string', 'blocks: expected an array'])

    expect(container.querySelector('h1')?.textContent).toBe('This document has errors')
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'title: expected a string',
      'blocks: expected an array',
    ])
  })

  it('heads the errors as it is told, such as for a link with a parameter it does not know', () => {
    const container = document.createElement('div')
    showErrors(container, ['provenence: unknown parameter'], 'This link has errors')

    expect(container.querySelector('h1')?.textContent).toBe('This link has errors')
  })
})

describe('a test document', () => {
  function mounted(count: number): HTMLElement {
    const container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, testDocument(count))
    return container
  }

  /** The banner's message, without its control or what that reveals. */
  const message = (container: HTMLElement) => container.firstElementChild?.querySelector('p')?.textContent

  it('opens with a banner above the title, saying how many statements are deliberately false, which nothing closes', () => {
    const container = mounted(2)
    const banner = container.firstElementChild

    expect(banner?.getAttribute('role')).toBe('note')
    expect(message(container)).toBe('Test document. 2 statements in it are deliberately false. Don’t rely on it until you’ve seen which.')
    expect(banner?.nextElementSibling?.tagName).toBe('H1')
    expect([...(banner?.querySelectorAll('[role="button"]') ?? [])].map((button) => button.textContent)).toEqual(['Show which'])

    click(control(container, 'p1'), 1)

    expect(message(container)).toBe('Test document. 2 statements in it are deliberately false. Don’t rely on it until you’ve seen which.')
  })

  it('says how many in the singular', () => {
    expect(message(mounted(1))).toMatch(/^Test document\. 1 statement in it is deliberately false\./)
  })

  it('shows which statements are false, what is wrong and what the generator wrote, keeping focus on its control and the page still', () => {
    const container = mounted(2)
    const reveal = () => byId(container, elementId.reveal) ?? document.body
    const statements = () =>
      [...(byId(container, elementId.planted)?.querySelectorAll('li') ?? [])].map((item) => [...item.children].map((part) => part.textContent))
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      expect([reveal().getAttribute('role'), reveal().getAttribute('aria-expanded')]).toEqual(['button', 'false'])

      reveal().click()

      expect([reveal().textContent, reveal().getAttribute('aria-expanded'), reveal().getAttribute('aria-controls')]).toEqual([
        'Hide which',
        'true',
        elementId.planted,
      ])
      expect(statements()).toEqual([
        ['“More instruction helps”', 'Contradicts the passage.', 'The generator wrote “More instruction hurts”'],
        ['“As 2025 benchmarks showed”', 'The passage names no benchmarks.', 'The generator wrote “Capability is uneven”'],
      ])
      expect(document.activeElement).toBe(reveal())
      expect(focus.mock.lastCall?.[0]).toEqual({ preventScroll: true })

      expect(press(reveal(), 'Enter').defaultPrevented).toBe(true)
      expect([reveal().textContent, statements()]).toEqual(['Show which', []])
    } finally {
      focus.mockRestore()
    }
  })

  it('shows no banner for any other document', () => {
    const container = document.createElement('div')
    mount(container, nested)

    expect(container.firstElementChild?.tagName).toBe('H1')
  })
})

describe('a study condition', () => {
  /** A compressed paragraph with a phrase that has several operations, and one of the author's that has only sources. */
  const mixed = documentFrom({
    title: 'T',
    blocks: [
      {
        provenance: 'compression',
        inlines: [
          {
            id: 'gist',
            short: 'A gist',
            elaborate: { provenance: 'approved', inlines: ['The author wrote this.'] },
            ground: [{ note: 'N', quote: 'The author wrote this.' }],
            challenge: ['An objection.'],
          },
          ' and ',
          { id: 'sourced', short: { provenance: 'approved', text: 'a sourced claim' }, ground: [{ note: 'N', quote: 'a claim' }] },
          '.',
        ],
      },
    ],
  })

  function mountedWith(conditions: Conditions): HTMLElement {
    const container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, mixed, conditions)
    return container
  }

  it('offers Elaborate alone, drawing a phrase with nothing else to open as marked text rather than a control', () => {
    const container = mountedWith({ operations: 'elaborate', provenance: 'switchable' })
    const fixed = [...container.querySelectorAll('p span')].find((span) => span.textContent === 'a sourced claim')

    expect([fixed?.getAttribute('role'), fixed?.className, fixed?.previousElementSibling?.getAttribute('aria-label')]).toEqual([
      null,
      'provenance-approved',
      'Approved',
    ])

    click(control(container, 'gist'), 1)

    expect([...container.querySelectorAll('[data-operation]')].map((button) => button.getAttribute('data-operation'))).toEqual(['elaborate'])
  })

  it('shows no Provenance switch when the condition fixes the marking, and no marks when it hides them', () => {
    const shown = mountedWith({ operations: 'all', provenance: 'shown' })

    expect([shown.querySelector('[data-provenance]'), shown.querySelectorAll('.provenance-mark').length > 0]).toEqual([null, true])
    expect(shown.querySelector('.provenance-legend')?.textContent).toBe('ApprovedAI compressionAI addition')

    const hidden = mountedWith({ operations: 'all', provenance: 'hidden' })

    expect([hidden.querySelector('.provenance'), hidden.querySelectorAll('.provenance-mark').length]).toEqual([null, 0])
  })
})

describe('a study session', () => {
  function mountedIn(conditions: Conditions): HTMLElement {
    const container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, nested, conditions)
    return container
  }

  it('offers a Download log button that saves the session’s log from a link on the page, which a held key does not press again', async () => {
    const container = mountedIn({ ...defaultConditions, session: 'reader-A' })
    const saved: Blob[] = []
    const links: { name: string; onPage: boolean }[] = []
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        saved.push(blob)
        return 'blob:log'
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url)
      },
    })
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      links.push({ name: this.download, onPage: this.isConnected })
    })
    // The page frees the file a minute after saving it, which must happen while the stand-ins are in place.
    vi.useFakeTimers()
    try {
      click(control(container, 'outer'), 1)
      const button = byId(container, elementId.download)

      expect([button?.tagName, button?.textContent]).toEqual(['BUTTON', 'Download log'])

      button?.click()
      const log = JSON.parse((await saved[0]?.text()) ?? '{}')

      expect([log.session, log.document, log.entries.map((entry: { intent: unknown }) => entry.intent)]).toEqual([
        'reader-A',
        'T',
        [{ kind: 'activate', id: 'outer' }],
      ])
      expect([saved[0]?.type, links.map((link) => link.onPage), links[0]?.name.startsWith('elastic-log-reader-A-')]).toEqual(['application/json', [true], true])
      expect(container.querySelector('a')).toBeNull()
      expect(press(button ?? document.body, 'Enter', { repeat: true }).defaultPrevented).toBe(true)
      expect(revoked).toEqual([])

      vi.advanceTimersByTime(60_000)

      expect(revoked).toEqual(['blob:log'])
    } finally {
      vi.useRealTimers()
      save.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('opens a test document with a study banner that does not count the errors or offer to show them', () => {
    const container = document.createElement('div')
    document.body.replaceChildren(container)
    mount(container, testDocument(2), { ...defaultConditions, session: 'reader-A' })
    const banner = container.firstElementChild

    expect([banner?.getAttribute('role'), banner?.textContent]).toEqual([
      'note',
      'Study document. Some AI text in it is wrong on purpose; you’ll be shown which at the end.',
    ])
    expect(byId(container, elementId.reveal)).toBeNull()
  })

  it('offers no Download log outside a session', () => {
    expect(byId(mountedIn(defaultConditions), elementId.download)).toBeNull()
  })
})
