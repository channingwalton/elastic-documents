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
        blocks: [{ provenance: 'addition', inlines: [text('An objection.')], attachments: [] }],
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
            provenance: 'addition',
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

describe('the depth', () => {
  const opened = (id: string, short: string, inlines: unknown[], chips: unknown[]) => ({ kind: 'long', id, short, inlines, chips })
  const ideaChips = (ground = false) => [
    { kind: 'toggle', operation: 'elaborate', pressed: true },
    { kind: 'toggle', operation: 'ground', count: 2, pressed: ground },
    { kind: 'toggle', operation: 'challenge', count: 1, pressed: false },
  ]
  const closedPhrase = (id: string, short: string) => ({ kind: 'phrase', id, text: short, chips: [] })

  it('starts at 0, and goes as deep as the deepest Elaborate', () => {
    expect(createReader(rich).depth()).toEqual({ current: 0, deepest: 2 })
    expect(createReader(documentFrom({ title: 'T', blocks: [[{ id: 'a', short: 'a', ground: [elastic] }]] })).depth()).toEqual({
      current: 0,
      deepest: 0,
    })
  })

  it('opens every Elaborate down to the depth, keeping the depth control where it is', () => {
    const reader = createReader(rich)

    expect(reader.dispatch({ kind: 'depth', depth: 1 })).toEqual({ focus: { kind: 'depth', depth: 1 }, keepStill: true })
    expect(reader.depth()).toEqual({ current: 1, deepest: 2 })
    const [idea, more] = reader.view()
    expect(idea?.inlines[1]).toEqual(opened('idea', 'stretchtext', [text('stretchtext, from 1967')], ideaChips()))
    expect(more?.inlines[1]).toEqual(opened('more', 'more', [text('more '), closedPhrase('inner', 'detail')], [{ kind: 'collapse' }]))

    reader.dispatch({ kind: 'depth', depth: 2 })
    expect(reader.view()[1]?.inlines[1]).toEqual(
      opened('more', 'more', [text('more '), opened('inner', 'detail', [text('detail inside')], [{ kind: 'collapse' }])], [
        { kind: 'collapse' },
      ]),
    )

    reader.dispatch({ kind: 'depth', depth: 0 })
    expect(reader.view()).toEqual(createReader(rich).view())
  })

  it('keeps what the reader opens and closes by hand until a depth is chosen again, which resets it', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'more' })
    reader.dispatch({ kind: 'depth', depth: 1 })
    reader.dispatch({ kind: 'toggle', id: 'more', operation: 'elaborate' })
    reader.dispatch({ kind: 'activate', id: 'idea' })
    expect(reader.view()[0]?.inlines[1]).toEqual(closedPhrase('idea', 'stretchtext'))
    expect(reader.view()[1]?.inlines[1]).toEqual(closedPhrase('more', 'more'))
    expect(reader.depth()).toEqual({ current: 0, deepest: 2 })

    reader.dispatch({ kind: 'depth', depth: 1 })
    expect(reader.view()[0]?.inlines[1]).toMatchObject({ kind: 'long', id: 'idea' })
    expect(reader.view()[1]?.inlines[1]).toMatchObject({ kind: 'long', id: 'more' })

    reader.dispatch({ kind: 'activate', id: 'inner' })
    reader.dispatch({ kind: 'depth', depth: 0 })
    expect(reader.view()).toEqual(createReader(rich).view())
    reader.dispatch({ kind: 'activate', id: 'more' })
    expect(reader.view()[1]?.inlines[1]).toMatchObject({ kind: 'long', inlines: [text('more '), closedPhrase('inner', 'detail')] })
  })

  it('reports no depth while what is open matches none, and the depth again once it matches one', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'depth', depth: 1 })

    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'elaborate' })
    expect(reader.depth()).toEqual({ current: undefined, deepest: 2 })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'elaborate' })
    expect(reader.depth()).toEqual({ current: 1, deepest: 2 })

    reader.dispatch({ kind: 'activate', id: 'inner' })
    expect(reader.depth()).toEqual({ current: 2, deepest: 2 })
  })

  it('counts a phrase left open inside a long form the reader closed', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'depth', depth: 2 })
    reader.dispatch({ kind: 'toggle', id: 'more', operation: 'elaborate' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'elaborate' })

    expect(reader.view()).toEqual(createReader(rich).view())
    expect(reader.depth()).toEqual({ current: undefined, deepest: 2 })
  })

  it('counts a phrase left open inside content the reader closed beneath a phrase', () => {
    const reader = createReader(
      documentFrom({ title: 'T', blocks: [[{ id: 'a', short: 'a', exemplify: [[{ id: 'b', short: 'b', elaborate: ['b inside'] }]] }]] }),
    )
    reader.dispatch({ kind: 'activate', id: 'a' })
    reader.dispatch({ kind: 'activate', id: 'b' })
    expect(reader.depth()).toEqual({ current: 1, deepest: 1 })

    reader.dispatch({ kind: 'activate', id: 'a' })
    expect(reader.depth()).toEqual({ current: 1, deepest: 1 })
  })

  it('keeps the depth while the reader opens and closes the other operations', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'depth', depth: 1 })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })
    reader.dispatch({ kind: 'activate', id: 'outer' })

    expect(reader.depth()).toEqual({ current: 1, deepest: 2 })
  })

  it('changes only Elaborate, leaving the other operations and the buttons shown as the reader set them', () => {
    const reader = createReader(rich)
    reader.dispatch({ kind: 'activate', id: 'idea' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })

    reader.dispatch({ kind: 'depth', depth: 1 })
    expect(reader.view()[0]?.inlines[1]).toEqual(opened('idea', 'stretchtext', [text('stretchtext, from 1967')], ideaChips(true)))

    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'ground' })
    reader.dispatch({ kind: 'depth', depth: 0 })
    expect(reader.view()[0]?.inlines[1]).toEqual({
      kind: 'phrase',
      id: 'idea',
      text: 'stretchtext',
      chips: ideaChips().map((chip) => ({ ...chip, pressed: false })),
    })
    expect(reader.view()[0]?.attachments).toEqual([])
  })

  it('applies the depth afresh in each paragraph opened beneath a phrase, whether opened before or after', () => {
    const exemplified = documentFrom({
      title: 'T',
      blocks: [[{ id: 'a', short: 'a', exemplify: [[{ id: 'b', short: 'b', elaborate: ['b inside'] }]] }]],
    })
    const expected = {
      operation: 'exemplify',
      blocks: [{ inlines: [opened('b', 'b', [text('b inside')], [{ kind: 'collapse' }])] }],
    }

    const before = createReader(exemplified)
    expect(before.depth()).toEqual({ current: 0, deepest: 1 })
    before.dispatch({ kind: 'activate', id: 'a' })
    before.dispatch({ kind: 'depth', depth: 1 })
    expect(before.view()[0]?.attachments[0]).toMatchObject(expected)

    const after = createReader(exemplified)
    after.dispatch({ kind: 'depth', depth: 1 })
    after.dispatch({ kind: 'activate', id: 'a' })
    expect(after.view()[0]?.attachments[0]).toMatchObject(expected)
  })

  it('opens the phrases inside a long form the reader closed, so they show at the depth when it reopens', () => {
    const reader = createReader(rich)
    const bothOpen = { kind: 'long', inlines: [text('more '), { kind: 'long', id: 'inner' }] }
    reader.dispatch({ kind: 'depth', depth: 1 })
    reader.dispatch({ kind: 'toggle', id: 'more', operation: 'elaborate' })
    reader.dispatch({ kind: 'depth', depth: 2 })
    expect(reader.view()[1]?.inlines[1]).toMatchObject(bothOpen)

    reader.dispatch({ kind: 'toggle', id: 'more', operation: 'elaborate' })
    expect(reader.view()[1]?.inlines[1]).toEqual(closedPhrase('more', 'more'))
    reader.dispatch({ kind: 'activate', id: 'more' })
    expect(reader.view()[1]?.inlines[1]).toMatchObject(bothOpen)
  })

  it('finds the deepest Elaborate in a document with very many phrases', () => {
    const many = Array.from({ length: 150_000 }, (_, i) => ({ id: `s${i}`, short: 's', elaborate: ['s'] }))

    expect(createReader(documentFrom({ title: 'T', blocks: [many] })).depth()).toEqual({ current: 0, deepest: 1 })
  })

  it('matches the depth in a document with very many phrases', () => {
    const many = Array.from({ length: 150_000 }, (_, i) => ({ id: `s${i}`, short: 's', elaborate: ['s'] }))
    const reader = createReader(documentFrom({ title: 'T', blocks: [many] }))

    reader.dispatch({ kind: 'activate', id: 's0' })
    expect(reader.depth()).toEqual({ current: undefined, deepest: 1 })
    reader.dispatch({ kind: 'depth', depth: 1 })
    expect(reader.depth()).toEqual({ current: 1, deepest: 1 })
  })

  it('ignores a depth the document does not have', () => {
    const reader = createReader(rich)

    for (const depth of [-1, 3, 0.5, Number.NaN]) expect(reader.dispatch({ kind: 'depth', depth })).toBeUndefined()
    expect(reader.depth()).toEqual({ current: 0, deepest: 2 })
    expect(reader.view()).toEqual(createReader(rich).view())
  })
})

describe('provenance', () => {
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
        inlines: [
          'A summary of ',
          {
            id: 'sum',
            short: 'the detail',
            elaborate: { provenance: 'approved', inlines: ["the detail, in the author's words"] },
            derive: ['A step.'],
          },
          '.',
        ],
      },
    ],
  })

  it('marks a level whose provenance differs from the text around it', () => {
    expect(createReader(marked).view()).toEqual([
      {
        inlines: [text('The idea is '), { kind: 'phrase', id: 'idea', text: 'stretchtext', provenance: 'compression', chips: [] }, text('.')],
        attachments: [],
      },
      {
        provenance: 'compression',
        inlines: [text('A summary of '), { kind: 'phrase', id: 'sum', text: 'the detail', chips: [] }, text('.')],
        attachments: [],
      },
    ])
  })

  it('marks a long form against the text around it, and content beneath against the page', () => {
    const reader = createReader(marked)
    for (const id of ['idea', 'sum']) {
      reader.dispatch({ kind: 'activate', id })
      reader.dispatch({ kind: 'toggle', id, operation: 'elaborate' })
    }
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'challenge' })
    reader.dispatch({ kind: 'toggle', id: 'sum', operation: 'derive' })
    const [idea, sum] = reader.view()

    expect(idea?.inlines[1]).not.toHaveProperty('provenance')
    expect(idea?.attachments).toMatchObject([{ operation: 'challenge', blocks: [{ provenance: 'addition', inlines: [text('An objection.')] }] }])
    expect(sum?.inlines[1]).toMatchObject({ kind: 'long', id: 'sum', provenance: 'approved' })
    expect(sum?.attachments).toMatchObject([{ operation: 'derive', blocks: [{ provenance: 'compression', inlines: [text('A step.')] }] }])
  })

  it('hides every mark while the reader has marking off, keeping the switch where it is', () => {
    const reader = createReader(marked)
    reader.dispatch({ kind: 'activate', id: 'idea' })
    reader.dispatch({ kind: 'toggle', id: 'idea', operation: 'challenge' })
    const shown = reader.view()

    expect(reader.dispatch({ kind: 'provenance' })).toEqual({ focus: { kind: 'provenance' }, keepStill: true })
    expect(reader.marking()).toEqual({ shown: false, needed: true })
    expect(JSON.stringify(reader.view())).not.toContain('provenance')

    reader.dispatch({ kind: 'provenance' })
    expect(reader.marking()).toEqual({ shown: true, needed: true })
    expect(reader.view()).toEqual(shown)
  })

  it('needs marking only when the document has text other than approved', () => {
    const approved = documentFrom({
      title: 'T',
      blocks: [['A ', { id: 'a', short: 'phrase', elaborate: ['longer phrase'], derive: ['A step.'], ground: [elastic] }]],
    })
    const withShort = (short: unknown) => documentFrom({ title: 'T', blocks: [[{ id: 'a', short, elaborate: ['a'] }]] })

    expect(createReader(approved).marking()).toEqual({ shown: true, needed: false })
    expect(createReader(withShort({ provenance: 'compression', text: 'a' })).marking().needed).toBe(true)
    expect(createReader(marked).marking().needed).toBe(true)
    expect(createReader(rich).marking().needed).toBe(true)
  })
})
