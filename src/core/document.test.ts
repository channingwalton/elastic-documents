import { describe, expect, it } from 'vitest'
import { available, count, parseDocument, type Stretch } from './document'

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
            inlines: [
              { kind: 'text', text: 'A document ' },
              {
                kind: 'stretch',
                id: 'reader',
                short: 'the reader stretches',
                elaborate: [
                  { kind: 'text', text: 'the reader stretches ' },
                  {
                    kind: 'stretch',
                    id: 'shrinks',
                    short: 'and shrinks',
                    elaborate: [{ kind: 'text', text: 'and shrinks again' }],
                  },
                ],
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
        'blocks[0]: expected an array of inlines',
        'blocks[1][0]: expected a string or a stretch object',
        'blocks[1][1].short: expected a non-empty string',
        'blocks[1][2].short: expected a non-empty string',
        'blocks[1][3].elaborate: expected an array of inlines',
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
            inlines: [
              {
                kind: 'stretch',
                id: 'a',
                short: 'a',
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
      short: 'a',
      derive: [{ inlines: [{ kind: 'text', text: 'First step.' }] }],
      exemplify: [
        {
          inlines: [
            { kind: 'text', text: 'An example with ' },
            { kind: 'stretch', id: 'b', short: 'a stretch', elaborate: [{ kind: 'text', text: 'a stretch inside' }] },
          ],
        },
      ],
      challenge: [{ inlines: [{ kind: 'text', text: 'An objection.' }] }, { inlines: [{ kind: 'text', text: 'Another.' }] }],
      reframe: [{ inlines: [{ kind: 'text', text: 'Another way to see it.' }] }],
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
        'blocks[0][0].challenge[0]: expected a string or an array of inlines',
        'blocks[0][0].challenge[1]: expected some text',
        'blocks[0][0].challenge[2][0].id: duplicate stretch id "a"',
      ],
    })
  })
})

describe('available and count', () => {
  const stretch: Stretch = {
    kind: 'stretch',
    id: 'a',
    short: 'a',
    reframe: [{ inlines: [{ kind: 'text', text: 'r' }] }],
    ground: [
      { note: 'n', quote: 'one' },
      { note: 'n', quote: 'two' },
    ],
    elaborate: [{ kind: 'text', text: 'long' }],
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
