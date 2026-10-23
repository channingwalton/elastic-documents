import { describe, expect, it } from 'vitest'
import { indexStretches, parseDocument, type ElasticDocument } from '../core/document'
import { documentFrom } from '../core/testing'
import { parsePlants, plant, type Plant } from './plant'

/** A document as the generator writes it: a passage with a headline and summary, beside one of the author's own phrases. */
const generated = documentFrom({
  title: 'Execution Classes',
  blocks: [
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p6',
          short: { provenance: 'compression', text: 'More instruction makes small models worse.' },
          elaborate: {
            provenance: 'compression',
            inlines: [
              {
                id: 'p6-summary',
                short: { provenance: 'compression', text: 'Past a point, small models degrade under more instruction.' },
                elaborate: { provenance: 'approved', inlines: ['Small models degrade differently. Past a point, more instruction makes them worse.'] },
              },
            ],
          },
        },
      ],
    },
    ['The author’s ', { id: 'own', short: 'own phrase', elaborate: ['own phrase, at length'] }, '.'],
  ],
})

const better: Plant = { level: 'p6', text: 'More instruction makes small models better.', error: 'Contradicts the note.' }

/** The planted copy, read back as the reader reads it. */
function planted(document: ElasticDocument, plants: readonly Plant[]): ElasticDocument {
  const result = plant(document, plants)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  const parsed = parseDocument(result.document)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.document
}

const shorts = (document: ElasticDocument) => [...indexStretches(document).values()].map(({ stretch }) => [stretch.id, stretch.short])

describe('plant', () => {
  it('puts each error in place of a level’s short form, still marked as AI text, and records what it said and what is wrong', () => {
    const copy = planted(generated, [better])

    expect(shorts(copy)).toEqual([
      ['p6', { provenance: 'compression', text: 'More instruction makes small models better.' }],
      ['p6-summary', { provenance: 'compression', text: 'Past a point, small models degrade under more instruction.' }],
      ['own', { provenance: 'approved', text: 'own phrase' }],
    ])
    expect(copy.planted).toEqual([{ level: 'p6', original: 'More instruction makes small models worse.', error: 'Contradicts the note.' }])
    expect(copy.blocks.slice(1)).toEqual(generated.blocks.slice(1))
  })

  it('adds to the errors a document has planted already', () => {
    const once = planted(generated, [better])

    const twice = planted(once, [{ level: 'p6-summary', text: 'Small models always degrade.', error: 'Drops “past a point”.' }])

    expect(twice.planted?.map((error) => error.level)).toEqual(['p6', 'p6-summary'])
  })

  it('refuses the author’s text, a level the document lacks, one planted already or twice, and text the level already says', () => {
    const once = planted(generated, [better])

    expect(
      plant(once, [
        { ...better, level: 'own' },
        { ...better, level: 'p9' },
        better,
        { ...better, level: 'p6-summary', text: 'Past a point, small models degrade under more instruction.' },
        { ...better, level: 'p6-summary', text: 'Small models never degrade.' },
        { ...better, level: 'p6-summary', text: 'Small models rarely degrade.' },
      ]),
    ).toEqual({
      ok: false,
      errors: [
        '[0].level: expected AI text, since an error planted in the author’s text would show as theirs',
        '[1].level: no stretch has the id "p9"',
        '[2].level: "p6" is planted already',
        '[3].text: the level already says this',
        '[5].level: "p6-summary" is planted already',
      ],
    })
  })
})

describe('plant, with spaces around the text', () => {
  it('counts text the level already says, give or take surrounding spaces, as no error, and plants text without them', () => {
    expect(plant(generated, [{ ...better, text: ' More instruction makes small models worse.\n' }])).toEqual({
      ok: false,
      errors: ['[0].text: the level already says this'],
    })
    expect(shorts(planted(generated, [{ ...better, text: '  More instruction makes small models better.\n' }]))[0]).toEqual([
      'p6',
      { provenance: 'compression', text: 'More instruction makes small models better.' },
    ])
  })
})

describe('parsePlants', () => {
  it('reads a list of errors to plant', () => {
    expect(parsePlants([better])).toEqual({ ok: true, plants: [better] })
  })

  it('names the path of every malformed entry', () => {
    expect(parsePlants({ level: 'p6' })).toEqual({ ok: false, errors: ['expected an array of { level, text, error }'] })
    expect(parsePlants([])).toEqual({ ok: false, errors: ['expected at least one error to plant'] })
    expect(parsePlants(['p6', { level: 'p6', text: ' ', note: 'x' }])).toEqual({
      ok: false,
      errors: ['[0]: expected { level, text, error }', '[1].note: unknown field', '[1].text: expected a non-empty string', '[1].error: expected a non-empty string'],
    })
  })
})
