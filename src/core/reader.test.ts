import { describe, expect, it } from 'vitest'
import { createReader } from './reader'
import { documentFrom } from './testing'

const stretchtext = { note: 'Stretchtext', date: '2026-10-19', quote: 'the reader remains oriented' }
const elastic = { note: 'Elastic Documents', quote: 'A summary opens into its detail.' }

const rich = documentFrom({
  title: 'T',
  blocks: [
    [
      'The idea is ',
      {
        id: 'idea',
        short: 'stretchtext',
        elaborate: ['stretchtext, from 1967'],
        ground: [stretchtext, elastic],
        challenge: ['An objection.'],
      },
      '.',
    ],
    ['Only ', { id: 'more', short: 'more', elaborate: ['more ', { id: 'inner', short: 'detail', elaborate: ['detail inside'] }] }, '.'],
    ['Only ', { id: 'src', short: 'sources', ground: [stretchtext] }, '.'],
    [
      'Nested ',
      {
        id: 'outer',
        short: 'claim',
        exemplify: [['An example with ', { id: 'deep', short: 'a source', ground: [elastic] }, '.']],
      },
      '.',
    ],
  ],
})

const text = (value: string) => ({ kind: 'text', text: value })

describe('createReader', () => {
  it('starts with every phrase closed, no operation buttons and nothing beneath', () => {
    const [idea] = createReader(rich).view()

    expect(idea).toEqual({
      inlines: [text('The idea is '), { kind: 'phrase', id: 'idea', text: 'stretchtext', chips: [] }, text('.')],
      attachments: [],
    })
  })

  it('opens a phrase with only Elaborate in place, keeping the page still', () => {
    const reader = createReader(rich)

    expect(reader.dispatch({ kind: 'activate', id: 'more' })).toEqual({ focus: { kind: 'long', id: 'more' }, keepStill: true })
    expect(reader.view()[1]?.inlines[1]).toEqual({
      kind: 'long',
      id: 'more',
      short: 'more',
      inlines: [text('more '), { kind: 'phrase', id: 'inner', text: 'detail', chips: [] }],
      chips: [{ kind: 'collapse' }],
    })
  })

  it('opens a phrase with only Ground beneath its block, and brings it into view', () => {
    const reader = createReader(rich)

    expect(reader.dispatch({ kind: 'activate', id: 'src' })).toEqual({
      focus: { kind: 'attachment', id: 'src', operation: 'ground' },
      keepStill: false,
    })
    expect(reader.view()[2]).toEqual({
      inlines: [
        text('Only '),
        { kind: 'phrase', id: 'src', text: 'sources', chips: [{ kind: 'toggle', operation: 'ground', count: 1, pressed: true }] },
        text('.'),
      ],
      attachments: [{ kind: 'passages', id: 'src', short: 'sources', operation: 'ground', passages: [stretchtext] }],
    })
  })

  it('shows the buttons of a phrase with several operations, with counts, and hides them again', () => {
    const reader = createReader(rich)

    expect(reader.dispatch({ kind: 'activate', id: 'idea' })).toEqual({
      focus: { kind: 'chip', id: 'idea', operation: 'elaborate' },
      keepStill: true,
    })
    expect(reader.view()[0]?.inlines[1]).toEqual({
      kind: 'phrase',
      id: 'idea',
      text: 'stretchtext',
      chips: [
        { kind: 'toggle', operation: 'elaborate', pressed: false },
        { kind: 'toggle', operation: 'ground', count: 2, pressed: false },
        { kind: 'toggle', operation: 'challenge', count: 1, pressed: false },
      ],
    })

    expect(reader.dispatch({ kind: 'activate', id: 'idea' })).toEqual({ focus: { kind: 'phrase', id: 'idea' }, keepStill: true })
    expect(reader.view()[0]?.inlines[1]).toEqual({ kind: 'phrase', id: 'idea', text: 'stretchtext', chips: [] })
  })

  it('opens operations beneath the block in a fixed order, whatever order they were opened in', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'idea' })

    expect(reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'challenge' })).toEqual({
      focus: { kind: 'attachment', id: 'idea', operation: 'challenge' },
      keepStill: false,
    })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })

    expect(reader.view()[0]?.attachments).toEqual([
      { kind: 'passages', id: 'idea', short: 'stretchtext', operation: 'ground', passages: [stretchtext, elastic] },
      {
        kind: 'blocks',
        id: 'idea',
        short: 'stretchtext',
        operation: 'challenge',
        blocks: [{ inlines: [text('An objection.')], attachments: [] }],
      },
    ])
  })

  it('elaborates in place while other operations stay open beneath', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'idea' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })

    expect(reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'elaborate' })).toEqual({
      focus: { kind: 'long', id: 'idea' },
      keepStill: true,
    })
    const [idea] = reader.view()
    expect(idea?.inlines[1]).toEqual({
      kind: 'long',
      id: 'idea',
      short: 'stretchtext',
      inlines: [text('stretchtext, from 1967')],
      chips: [
        { kind: 'toggle', operation: 'elaborate', pressed: true },
        { kind: 'toggle', operation: 'ground', count: 2, pressed: true },
        { kind: 'toggle', operation: 'challenge', count: 1, pressed: false },
      ],
    })
    expect(idea?.attachments.map((a) => a.operation)).toEqual(['ground'])
  })

  it('returns focus to the button of a closed operation while the buttons show, and to the phrase otherwise', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'idea' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })
    expect(reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })).toEqual({
      focus: { kind: 'chip', id: 'idea', operation: 'ground' },
      keepStill: false,
    })

    reader.dispatch({ kind: 'activate', id: 'src' })
    expect(reader.dispatch({ kind: 'toggle', id: 'src', operation: 'ground' })).toEqual({
      focus: { kind: 'phrase', id: 'src' },
      keepStill: false,
    })
    expect(reader.view()[2]?.attachments).toEqual([])
  })

  it('closes everything on a phrase when it is activated with something open', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'idea' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })

    expect(reader.dispatch({ kind: 'activate', id: 'idea' })).toEqual({ focus: { kind: 'phrase', id: 'idea' }, keepStill: false })
    expect(reader.view()[0]).toEqual(createReader(rich).view()[0])
  })

  it('opens a phrase inside content beneath, and puts its own content beneath that block', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'outer' })
    reader.dispatch({ kind: 'activate', id: 'deep' })

    expect(reader.view()[3]?.attachments).toEqual([
      {
        kind: 'blocks',
        id: 'outer',
        short: 'claim',
        operation: 'exemplify',
        blocks: [
          {
            inlines: [
              text('An example with '),
              { kind: 'phrase', id: 'deep', text: 'a source', chips: [{ kind: 'toggle', operation: 'ground', count: 1, pressed: true }] },
              text('.'),
            ],
            attachments: [{ kind: 'passages', id: 'deep', short: 'a source', operation: 'ground', passages: [elastic] }],
          },
        ],
      },
    ])
  })

  it('keeps a nested phrase open while its parent is closed, and shows it again when the parent reopens', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'more' })
    reader.dispatch({ kind: 'activate', id: 'inner' })
    const bothOpen = reader.view()

    reader.dispatch({ kind: 'activate', id: 'more' })
    expect(reader.view()).toEqual(createReader(rich).view())

    reader.dispatch({ kind: 'activate', id: 'more' })
    expect(reader.view()).toEqual(bothOpen)
  })

  it('ignores a phrase that is not in the document and an operation the phrase does not have', () => {
    const reader = createReader(rich)

    expect(reader.dispatch({ kind: 'activate', id: 'missing' })).toBeUndefined()
    expect(reader.dispatch({ kind: 'toggle', id: 'more', operation: 'ground' })).toBeUndefined()
    expect(reader.view()).toEqual(createReader(rich).view())
  })
})
