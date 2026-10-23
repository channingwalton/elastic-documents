import { describe, expect, it } from 'vitest'
import { available, count, indexStretches, mapStretches, parseDocument, toJson, type ElasticDocument, type Inline, type Stretch } from './document'
import sample from '../../examples/sample.json'
import { documentFrom, testDocument } from './testing'

describe('parseDocument', () => {
  it('reads strings as text and objects as stretches, at any depth', () => {
    const parsed = parseDocument({
      title: 'Elastic Documents',
      blocks: [
        [
          'A document ',
          {
            id: 'reader',
            short: 'the reader stretches',
            elaborate: ['the reader stretches ', { id: 'shrinks', short: 'and shrinks', elaborate: ['and shrinks again'] }],
          },
          '.',
        ],
      ],
    })

    expect(parsed).toEqual({
      ok: true,
      document: {
        title: 'Elastic Documents',
        blocks: [
          {
            provenance: 'approved',
            inlines: [
              { kind: 'text', text: 'A document ' },
              {
                kind: 'stretch',
                id: 'reader',
                short: { provenance: 'approved', text: 'the reader stretches' },
                elaborate: {
                  provenance: 'approved',
                  inlines: [
                    { kind: 'text', text: 'the reader stretches ' },
                    {
                      kind: 'stretch',
                      id: 'shrinks',
                      short: { provenance: 'approved', text: 'and shrinks' },
                      elaborate: { provenance: 'approved', inlines: [{ kind: 'text', text: 'and shrinks again' }] },
                    },
                  ],
                },
              },
              { kind: 'text', text: '.' },
            ],
          },
        ],
      },
    })
  })

  it('rejects input that is not a document', () => {
    expect(parseDocument('nope')).toEqual({ ok: false, errors: ['document: expected an object'] })
    expect(parseDocument({ blocks: [] })).toEqual({ ok: false, errors: ['title: expected a non-empty string'] })
    expect(parseDocument({ title: '', blocks: [] })).toEqual({ ok: false, errors: ['title: expected a non-empty string'] })
    expect(parseDocument({ title: '   ', blocks: [] })).toEqual({ ok: false, errors: ['title: expected a non-empty string'] })
    expect(parseDocument({ title: 'T' })).toEqual({ ok: false, errors: ['blocks: expected an array'] })
  })

  it('names the path of every malformed block and inline', () => {
    const parsed = parseDocument({
      title: 'T',
      blocks: [
        'not a block',
        [
          42,
          { id: 'a', elaborate: ['a'] },
          { id: 'b', short: '', elaborate: ['b'] },
          { id: 'c', short: 'c', elaborate: 'x' },
          { id: 'd', short: 'd', elaborate: [] },
        ],
      ],
    })

    expect(parsed).toEqual({
      ok: false,
      errors: [
        'blocks[0]: expected an array of inlines or { provenance, inlines }',
        'blocks[1][0]: expected a string or a stretch object',
        'blocks[1][1].short: expected a non-empty string',
        'blocks[1][2].short: expected a non-empty string',
        'blocks[1][3].elaborate: expected an array of inlines or { provenance, inlines }',
        'blocks[1][4].elaborate: expected some text',
      ],
    })
  })

  it('reports errors in the blocks alongside an invalid title', () => {
    expect(parseDocument({ title: '', blocks: [[{ id: 'a', short: '', elaborate: ['a'] }]] })).toEqual({
      ok: false,
      errors: ['title: expected a non-empty string', 'blocks[0][0].short: expected a non-empty string'],
    })
  })

  it('rejects a blank short form and an id with spaces', () => {
    expect(parseDocument({ title: 'T', blocks: [[{ id: 'a b', short: '  ', elaborate: ['x'] }]] })).toEqual({
      ok: false,
      errors: ['blocks[0][0].id: expected an id without spaces', 'blocks[0][0].short: expected a non-empty string'],
    })
  })

  it('rejects a block or long form with no visible text, but accepts spaces between stretches', () => {
    expect(
      parseDocument({ title: 'T', blocks: [[], ['  '], [{ id: 'a', short: 'a', elaborate: [''] }]] }),
    ).toEqual({
      ok: false,
      errors: ['blocks[0]: expected some text', 'blocks[1]: expected some text', 'blocks[2][0].elaborate: expected some text'],
    })

    expect(
      parseDocument({
        title: 'T',
        blocks: [[{ id: 'a', short: 'a', elaborate: ['a'] }, ' ', { id: 'b', short: 'b', elaborate: ['b'] }]],
      }).ok,
    ).toBe(true)
  })

  it('rejects a stretch id used twice, wherever it appears', () => {
    const parsed = parseDocument({
      title: 'T',
      blocks: [
        [{ id: 'dup', short: 'one', elaborate: [{ id: 'dup', short: 'two', elaborate: ['two'] }] }],
      ],
    })

    expect(parsed).toEqual({ ok: false, errors: ['blocks[0][0].elaborate[0].id: duplicate stretch id "dup"'] })
  })

  it('rejects a stretch without a string id', () => {
    expect(parseDocument({ title: 'T', blocks: [[{ short: 's', elaborate: ['s'] }]] })).toEqual({
      ok: false,
      errors: ['blocks[0][0].id: expected a non-empty string'],
    })
  })
})

describe('parseDocument operations', () => {
  function stretchFrom(json: Record<string, unknown>) {
    return parseDocument({ title: 'T', blocks: [[{ id: 'a', short: 'a', ...json }]] })
  }

  it('reads Ground passages, with or without a date', () => {
    expect(
      stretchFrom({
        ground: [
          { note: 'Stretchtext', date: '2026-10-19', quote: 'the reader remains oriented' },
          { note: 'Elastic Documents', quote: 'A summary opens into its detail.' },
        ],
      }),
    ).toEqual({
      ok: true,
      document: {
        title: 'T',
        blocks: [
          {
            provenance: 'approved',
            inlines: [
              {
                kind: 'stretch',
                id: 'a',
                short: { provenance: 'approved', text: 'a' },
                ground: [
                  { note: 'Stretchtext', date: '2026-10-19', quote: 'the reader remains oriented' },
                  { note: 'Elastic Documents', quote: 'A summary opens into its detail.' },
                ],
              },
            ],
          },
        ],
      },
    })
  })

  it('reads the list operations as blocks, where a string stands for a block of plain text', () => {
    const parsed = stretchFrom({
      derive: ['First step.'],
      exemplify: [['An example with ', { id: 'b', short: 'a stretch', elaborate: ['a stretch inside'] }]],
      challenge: ['An objection.', 'Another.'],
      reframe: ['Another way to see it.'],
    })
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))

    expect(parsed.document.blocks[0]?.inlines[0]).toEqual({
      kind: 'stretch',
      id: 'a',
      short: { provenance: 'approved', text: 'a' },
      derive: [{ provenance: 'approved', inlines: [{ kind: 'text', text: 'First step.' }] }],
      exemplify: [
        {
          provenance: 'addition',
          inlines: [
            { kind: 'text', text: 'An example with ' },
            {
              kind: 'stretch',
              id: 'b',
              short: { provenance: 'addition', text: 'a stretch' },
              elaborate: { provenance: 'addition', inlines: [{ kind: 'text', text: 'a stretch inside' }] },
            },
          ],
        },
      ],
      challenge: [
        { provenance: 'addition', inlines: [{ kind: 'text', text: 'An objection.' }] },
        { provenance: 'addition', inlines: [{ kind: 'text', text: 'Another.' }] },
      ],
      reframe: [{ provenance: 'addition', inlines: [{ kind: 'text', text: 'Another way to see it.' }] }],
    })
  })

  it('rejects a stretch with no operation, and a field it does not know', () => {
    expect(stretchFrom({})).toEqual({ ok: false, errors: ['blocks[0][0]: expected at least one operation'] })
    expect(stretchFrom({ elaborate: ['a'], chalenge: ['typo'] })).toEqual({
      ok: false,
      errors: ['blocks[0][0].chalenge: unknown field'],
    })
  })

  it('rejects a passage field it does not know', () => {
    expect(stretchFrom({ ground: [{ note: 'n', quote: 'q', dat: '2026-10-19' }] })).toEqual({
      ok: false,
      errors: ['blocks[0][0].ground[0].dat: unknown field'],
    })
  })

  it('names the path of every malformed passage', () => {
    expect(stretchFrom({ ground: 'x' })).toEqual({ ok: false, errors: ['blocks[0][0].ground: expected an array'] })
    expect(stretchFrom({ ground: [] })).toEqual({ ok: false, errors: ['blocks[0][0].ground: expected at least one item'] })
    expect(stretchFrom({ ground: ['x', { quote: 'q' }, { note: 'n', quote: ' ', date: 5 }] })).toEqual({
      ok: false,
      errors: [
        'blocks[0][0].ground[0]: expected a passage object',
        'blocks[0][0].ground[1].note: expected a non-empty string',
        'blocks[0][0].ground[2].quote: expected a non-empty string',
        'blocks[0][0].ground[2].date: expected a non-empty string',
      ],
    })
  })

  it('reports errors in the fixed order of the operations', () => {
    expect(stretchFrom({ reframe: [], challenge: [], exemplify: [], derive: [], ground: [], elaborate: [] })).toEqual({
      ok: false,
      errors: [
        'blocks[0][0].elaborate: expected some text',
        'blocks[0][0].ground: expected at least one item',
        'blocks[0][0].derive: expected at least one item',
        'blocks[0][0].exemplify: expected at least one item',
        'blocks[0][0].challenge: expected at least one item',
        'blocks[0][0].reframe: expected at least one item',
      ],
    })
  })

  it('names the path of every malformed list item', () => {
    expect(stretchFrom({ derive: [] })).toEqual({ ok: false, errors: ['blocks[0][0].derive: expected at least one item'] })
    expect(stretchFrom({ challenge: [42, '  ', [{ id: 'a', short: 'dup', elaborate: ['dup'] }]] })).toEqual({
      ok: false,
      errors: [
        'blocks[0][0].challenge[0]: expected a string, an array of inlines or { provenance, inlines }',
        'blocks[0][0].challenge[1]: expected some text',
        'blocks[0][0].challenge[2][0].id: duplicate stretch id "a"',
      ],
    })
  })
})

/** Every paragraph, short form and long form in the document with its provenance, in document order. */
function levels(document: ElasticDocument): string[] {
  const found: string[] = []
  const visit = (inlines: readonly Inline[]): void => {
    for (const inline of inlines) {
      if (inline.kind === 'text') continue
      found.push(`${inline.id}.short: ${inline.short.provenance}`)
      if (inline.elaborate) {
        found.push(`${inline.id}.elaborate: ${inline.elaborate.provenance}`)
        visit(inline.elaborate.inlines)
      }
      for (const operation of ['derive', 'exemplify', 'challenge', 'reframe'] as const) {
        inline[operation]?.forEach((block, i) => {
          found.push(`${inline.id}.${operation}[${i}]: ${block.provenance}`)
          visit(block.inlines)
        })
      }
    }
  }
  document.blocks.forEach((block, i) => {
    found.push(`blocks[${i}]: ${block.provenance}`)
    visit(block.inlines)
  })
  return found
}

describe('parseDocument provenance', () => {
  it('gives an unmarked level the provenance of the level around it, starting from approved', () => {
    const document = documentFrom({
      title: 'T',
      blocks: [
        ['An author paragraph with ', { id: 'a', short: 'a phrase', elaborate: ['a phrase ', { id: 'b', short: 'inside', derive: ['A step.'] }] }],
        { provenance: 'compression', inlines: ['A summary with ', { id: 'c', short: 'a phrase', elaborate: ['a longer phrase'], derive: ['A step.'] }] },
      ],
    })

    expect(levels(document)).toEqual([
      'blocks[0]: approved',
      'a.short: approved',
      'a.elaborate: approved',
      'b.short: approved',
      'b.derive[0]: approved',
      'blocks[1]: compression',
      'c.short: compression',
      'c.elaborate: compression',
      'c.derive[0]: compression',
    ])
  })

  it('reads a mark on a paragraph, short form or long form, which the levels inside it then take', () => {
    const document = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'a',
              short: 'a summary',
              elaborate: {
                provenance: 'approved',
                inlines: ["the author's words, with ", { id: 'b', short: { provenance: 'compression', text: 'a summary' }, elaborate: ["the author's detail"] }],
              },
            },
          ],
        },
        [
          {
            id: 'c',
            short: 'terse',
            elaborate: { provenance: 'addition', inlines: ['an expansion with ', { id: 'd', short: 'more', elaborate: ['more'] }] },
            derive: [{ provenance: 'compression', inlines: ['A step.'] }],
          },
        ],
      ],
    })

    expect(levels(document)).toEqual([
      'blocks[0]: compression',
      'a.short: compression',
      'a.elaborate: approved',
      'b.short: compression',
      'b.elaborate: approved',
      'blocks[1]: approved',
      'c.short: approved',
      'c.elaborate: addition',
      'd.short: addition',
      'd.elaborate: addition',
      'c.derive[0]: compression',
    ])
    expect(indexStretches(document).get('b')?.stretch.short).toEqual({ provenance: 'compression', text: 'a summary' })
  })

  it('makes Exemplify, Challenge and Reframe additions, along with every level inside them', () => {
    const document = documentFrom({
      title: 'T',
      blocks: [
        [
          {
            id: 'a',
            short: 'a',
            exemplify: [['An example with ', { id: 'b', short: 'a phrase', elaborate: ['a longer phrase'] }]],
            challenge: [{ provenance: 'addition', inlines: ['An objection.'] }],
            reframe: ['Another way to see it.'],
          },
        ],
      ],
    })

    expect(levels(document)).toEqual([
      'blocks[0]: approved',
      'a.short: approved',
      'a.exemplify[0]: addition',
      'b.short: addition',
      'b.elaborate: addition',
      'a.challenge[0]: addition',
      'a.reframe[0]: addition',
    ])
  })

  it('names the path of every malformed mark', () => {
    const parsed = parseDocument({
      title: 'T',
      blocks: [
        { provenance: 'invented', inlines: ['x'] },
        { inlines: ['x'] },
        { provenance: 'approved', inlines: 'x', source: 'n' },
        [{ id: 'a', short: { provenance: 'compression', text: ' ', tone: 'dry' }, elaborate: { provenance: 'approved' } }],
        [{ id: 'b', short: 'b', ground: [{ note: 'n', quote: 'q', provenance: 'approved' }] }],
      ],
    })

    expect(parsed).toEqual({
      ok: false,
      errors: [
        'blocks[0].provenance: expected "approved", "compression" or "addition"',
        'blocks[1].provenance: expected "approved", "compression" or "addition"',
        'blocks[2].source: unknown field',
        'blocks[2].inlines: expected an array of inlines',
        'blocks[3][0].short.tone: unknown field',
        'blocks[3][0].short.text: expected a non-empty string',
        'blocks[3][0].elaborate.inlines: expected an array of inlines',
        'blocks[4][0].ground[0].provenance: unknown field',
      ],
    })
  })

  it('reads the sample, which marks every provenance', () => {
    const marks = levels(documentFrom(sample)).map((level) => level.split(': ')[1])

    expect(new Set(marks)).toEqual(new Set(['approved', 'compression', 'addition']))
  })

  it('reports a stretch put where an array of inlines belongs as one error, not as a malformed mark', () => {
    const stretch = { id: 'x', short: 'x', elaborate: ['x'] }

    expect(
      parseDocument({ title: 'T', blocks: [{ ...stretch, id: 'a' }, [{ id: 'b', short: 'b', elaborate: { ...stretch, id: 'c' }, derive: [{ ...stretch, id: 'd' }] }]] }),
    ).toEqual({
      ok: false,
      errors: [
        'blocks[0]: expected an array of inlines or { provenance, inlines }',
        'blocks[1][0].elaborate: expected an array of inlines or { provenance, inlines }',
        'blocks[1][0].derive[0]: expected a string, an array of inlines or { provenance, inlines }',
      ],
    })
  })

  it('rejects a mark other than addition inside an addition', () => {
    const parsed = parseDocument({
      title: 'T',
      blocks: [
        [
          {
            id: 'a',
            short: 'a',
            elaborate: {
              provenance: 'addition',
              inlines: ['an expansion with ', { id: 'b', short: { provenance: 'compression', text: 'b' }, elaborate: ['b'] }],
            },
            challenge: [
              { provenance: 'approved', inlines: ['An objection.'] },
              [{ id: 'c', short: 'c', elaborate: { provenance: 'compression', inlines: ['c'] } }],
            ],
          },
        ],
      ],
    })

    expect(parsed).toEqual({
      ok: false,
      errors: [
        'blocks[0][0].elaborate.inlines[1].short.provenance: expected "addition" inside an addition',
        'blocks[0][0].challenge[0].provenance: expected "addition" inside an addition',
        'blocks[0][0].challenge[1][0].elaborate.provenance: expected "addition" inside an addition',
      ],
    })
  })
})

describe('parseDocument planted errors', () => {
  /** A generated passage whose headline is AI text, beside a phrase of the author's own. */
  const tested = {
    title: 'Test',
    blocks: [
      {
        provenance: 'compression',
        inlines: [
          {
            id: 'p1',
            short: { provenance: 'compression', text: 'More instruction helps small models' },
            elaborate: { provenance: 'approved', inlines: ['Past a point, more instruction makes small models worse.'] },
          },
        ],
      },
      ['The author’s ', { id: 'own', short: 'own phrase', elaborate: ['own phrase, at length'] }, '.'],
    ],
  }
  const planted = {
    level: 'p1',
    original: 'More instruction hurts small models',
    error: 'Contradicts the passage, which says more instruction makes small models worse.',
  }

  it('reads each level planted with an error, with what the generator wrote and what is wrong', () => {
    const parsed = parseDocument({ ...tested, planted: [planted] })

    expect(parsed.ok && parsed.document.planted).toEqual([planted])
  })

  it('leaves a document with no planted errors as it was', () => {
    const parsed = parseDocument(tested)

    expect(parsed.ok && parsed.document).not.toHaveProperty('planted')
  })

  it('rejects a planted level that is the author’s text, does not exist, or is planted twice', () => {
    const parsed = parseDocument({ ...tested, planted: [planted, { ...planted, level: 'own' }, { ...planted, level: 'p9' }, planted] })

    expect(parsed).toEqual({
      ok: false,
      errors: [
        'planted[1].level: expected AI text, since an error planted in the author’s text would show as theirs',
        'planted[2].level: no stretch has the id "p9"',
        'planted[3].level: "p1" is planted more than once',
      ],
    })
  })

  it('rejects a planted level that still says what the generator wrote, so the banner counts only false statements', () => {
    expect(parseDocument({ ...tested, planted: [{ ...planted, original: ' More instruction helps small models\n' }] })).toEqual({
      ok: false,
      errors: ['planted[0].original: the level still says this, so no error was planted in it'],
    })
  })

  it('names the path of every malformed planted error', () => {
    expect(parseDocument({ ...tested, planted: 'p1' })).toEqual({ ok: false, errors: ['planted: expected an array'] })
    expect(parseDocument({ ...tested, planted: [] })).toEqual({ ok: false, errors: ['planted: expected at least one item'] })
    expect(parseDocument({ ...tested, planted: ['p1', { original: '', error: ' ', note: 'x' }] })).toEqual({
      ok: false,
      errors: [
        'planted[0]: expected an object',
        'planted[1].note: unknown field',
        'planted[1].level: expected a non-empty string',
        'planted[1].original: expected a non-empty string',
        'planted[1].error: expected a non-empty string',
      ],
    })
  })

  it('rejects a field it does not know at the top of the document, so a misspelt record cannot pass unnoticed', () => {
    expect(parseDocument({ ...tested, plantd: [planted] })).toEqual({ ok: false, errors: ['plantd: unknown field'] })
  })
})

describe('available and count', () => {
  const stretch: Stretch = {
    kind: 'stretch',
    id: 'a',
    short: { provenance: 'approved', text: 'a' },
    reframe: [{ provenance: 'addition', inlines: [{ kind: 'text', text: 'r' }] }],
    ground: [
      { note: 'n', quote: 'one' },
      { note: 'n', quote: 'two' },
    ],
    elaborate: { provenance: 'approved', inlines: [{ kind: 'text', text: 'long' }] },
  }

  it('lists the operations a stretch has, in the fixed order', () => {
    expect(available(stretch)).toEqual(['elaborate', 'ground', 'reframe'])
  })

  it('counts the items of an operation, and gives Elaborate no count', () => {
    expect([count(stretch, 'elaborate'), count(stretch, 'ground'), count(stretch, 'reframe'), count(stretch, 'derive')]).toEqual([
      undefined,
      2,
      1,
      undefined,
    ])
  })
})

describe('indexStretches', () => {
  it('finds every stretch by id with its level, which starts again at 1 in each paragraph opened beneath', () => {
    const index = indexStretches(
      documentFrom({
        title: 'T',
        blocks: [
          [
            {
              id: 'a',
              short: 'a',
              elaborate: ['a ', { id: 'b', short: 'b', elaborate: ['b ', { id: 'c', short: 'c', elaborate: ['c'] }] }],
              exemplify: [[{ id: 'd', short: 'd', elaborate: ['d'] }]],
            },
          ],
          [{ id: 'e', short: 'e', ground: [{ note: 'n', quote: 'q' }] }],
        ],
      }),
    )

    expect([...index].map(([id, { stretch, level }]) => [id, stretch.short.text, level])).toEqual([
      ['a', 'a', 1],
      ['b', 'b', 2],
      ['c', 'c', 3],
      ['d', 'd', 1],
      ['e', 'e', 1],
    ])
  })
})

describe('toJson', () => {
  it('writes a document that reads back exactly as it was, planted errors and all', () => {
    for (const document of [documentFrom(sample), testDocument(2)]) {
      expect(parseDocument(toJson(document))).toEqual({ ok: true, document })
    }
  })

  it('marks every level with its provenance', () => {
    const document = documentFrom({
      title: 'Marked',
      blocks: [
        [
          'Plain ',
          {
            id: 'a',
            short: 'phrase',
            elaborate: ['the long form'],
            ground: [{ note: 'Note', date: '2026-01-01', quote: 'the long form' }],
            exemplify: [['An example with ', { id: 'b', short: 'a phrase', reframe: ['Put another way.'] }]],
          },
        ],
      ],
    })

    expect(toJson(document)).toEqual({
      title: 'Marked',
      blocks: [
        {
          provenance: 'approved',
          inlines: [
            'Plain ',
            {
              id: 'a',
              short: { provenance: 'approved', text: 'phrase' },
              elaborate: { provenance: 'approved', inlines: ['the long form'] },
              ground: [{ note: 'Note', date: '2026-01-01', quote: 'the long form' }],
              exemplify: [
                {
                  provenance: 'addition',
                  inlines: [
                    'An example with ',
                    {
                      id: 'b',
                      short: { provenance: 'addition', text: 'a phrase' },
                      reframe: [{ provenance: 'addition', inlines: ['Put another way.'] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  })

})

describe('mapStretches', () => {
  const nestedDocument = documentFrom({
    title: 'T',
    blocks: [
      [
        { id: 'outer', short: 'outer', elaborate: ['the ', { id: 'inner', short: 'inner', elaborate: ['inner at length'] }] },
        ' and ',
        { id: 'listed', short: 'listed', derive: [['a step with ', { id: 'step', short: 'step', elaborate: ['a step at length'] }]] },
      ],
    ],
  })

  it('changes every stretch, wherever it is nested, after the stretches inside it', () => {
    const seen: string[] = []

    const changed = mapStretches(nestedDocument, (stretch) => {
      seen.push(stretch.id)
      return { ...stretch, short: { ...stretch.short, text: stretch.short.text.toUpperCase() } }
    })

    expect(seen).toEqual(['inner', 'outer', 'step', 'listed'])
    expect([...indexStretches(changed).values()].map(({ stretch }) => stretch.short.text)).toEqual(['OUTER', 'INNER', 'LISTED', 'STEP'])
    expect([...indexStretches(nestedDocument).values()].map(({ stretch }) => stretch.short.text)).toEqual(['outer', 'inner', 'listed', 'step'])
  })
})
