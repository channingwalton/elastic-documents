import { describe, expect, it } from 'vitest'
import { documentFrom } from './testing'
import { toggle, view } from './view'

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
  ],
})

describe('toggle', () => {
  it('opens a closed stretch and closes an open one, leaving the original set unchanged', () => {
    const none = new Set<string>()
    const opened = toggle(none, 'outer')

    expect([...opened]).toEqual(['outer'])
    expect([...toggle(opened, 'outer')]).toEqual([])
    expect(none.size).toBe(0)
  })
})

describe('view', () => {
  it('shows the short form of every closed stretch', () => {
    expect(view(nested, new Set())).toEqual([
      [
        { kind: 'text', text: 'A document ' },
        { kind: 'stretch', id: 'outer', open: false, text: 'the reader stretches' },
        { kind: 'text', text: '.' },
      ],
    ])
  })

  it('puts the long form of an open stretch in place of its short form', () => {
    expect(view(nested, new Set(['outer']))).toEqual([
      [
        { kind: 'text', text: 'A document ' },
        {
          kind: 'stretch',
          id: 'outer',
          open: true,
          short: 'the reader stretches',
          inlines: [
            { kind: 'text', text: 'the reader stretches ' },
            { kind: 'stretch', id: 'inner', open: false, text: 'and shrinks' },
          ],
        },
        { kind: 'text', text: '.' },
      ],
    ])
  })

  it('opens a stretch nested inside an open one', () => {
    const [block] = view(nested, new Set(['outer', 'inner']))

    expect(block?.[1]).toEqual({
      kind: 'stretch',
      id: 'outer',
      open: true,
      short: 'the reader stretches',
      inlines: [
        { kind: 'text', text: 'the reader stretches ' },
        {
          kind: 'stretch',
          id: 'inner',
          open: true,
          short: 'and shrinks',
          inlines: [{ kind: 'text', text: 'and shrinks in place' }],
        },
      ],
    })
  })

  it('hides an open stretch whose parent is closed, and restores it when the parent reopens', () => {
    const innerOnly = new Set(['inner'])
    expect(view(nested, innerOnly)).toEqual(view(nested, new Set()))

    const reopened = toggle(innerOnly, 'outer')
    expect(view(nested, reopened)).toEqual(view(nested, new Set(['outer', 'inner'])))
  })

  it('ignores open ids that are not in the document', () => {
    expect(view(nested, new Set(['missing']))).toEqual(view(nested, new Set()))
  })
})
