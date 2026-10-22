// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Operation } from '../core/document'
import { documentFrom } from '../core/testing'
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

describe('showErrors', () => {
  it('lists each parse error', () => {
    const container = document.createElement('div')
    showErrors(container, ['title: expected a string', 'blocks: expected an array'])

    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'title: expected a string',
      'blocks: expected an array',
    ])
  })
})
