// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { documentFrom } from '../core/testing'
import { mount, showErrors } from './render'

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

function stretch(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-stretch="${id}"]`)
  if (!element) throw new Error(`no stretch ${id}`)
  return element
}

/** The control that opens a closed stretch or collapses an open one. */
function control(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-toggle="${id}"]`)
  if (!element) throw new Error(`no control for ${id}`)
  return element
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
