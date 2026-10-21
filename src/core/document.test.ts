import { describe, expect, it } from 'vitest'
import { parseDocument } from './document'

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
