import { describe, expect, it } from 'vitest'
import sample from '../../examples/sample.json'
import { indexStretches, parseDocument, type ElasticDocument } from '../core/document'
import { documentFrom } from '../core/testing'
import type { Flag } from './check'
import { reviewCopy } from './review'

const long = 'A naive reading of execution classes is "weaker model, longer prompt". This fails in practice.'

/** A passage with a headline and a summary, as the generator writes it, whose summary already has an objection. */
const generated = documentFrom({
  title: 'Execution Classes',
  blocks: [
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p1',
          short: { provenance: 'compression', text: 'Longer prompts fail' },
          elaborate: {
            provenance: 'compression',
            inlines: [
              {
                id: 'p1-summary',
                short: { provenance: 'compression', text: 'Longer prompts fail small models.' },
                elaborate: { provenance: 'approved', inlines: [long] },
                challenge: ['An objection the document already has.'],
              },
            ],
          },
        },
      ],
    },
  ],
})

const flag = (level: string, verdict: Flag['verdict'], claim: string, evidence: readonly string[]): Flag => ({
  level,
  text: level,
  passage: long,
  claim,
  verdict,
  evidence,
})

/** The text of each Challenge item on a level of the copy, once the reader has parsed it. */
function challenges(document: ElasticDocument, id: string): string[] {
  const challenge = indexStretches(document).get(id)?.stretch.challenge ?? []
  return challenge.map(({ provenance, inlines }) => `${provenance}: ${inlines.map((inline) => (inline.kind === 'text' ? inline.text : `[${inline.id}]`)).join('')}`)
}

function parsed(json: unknown): ElasticDocument {
  const result = parseDocument(json)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.document
}

describe('reviewCopy', () => {
  it('copies a document with nothing flagged as the reader reads it', () => {
    const document = documentFrom(sample)

    expect(parsed(reviewCopy(document, []))).toEqual(document)
    expect(parsed(reviewCopy(generated, []))).toEqual(generated)
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

    expect(reviewCopy(document, [])).toEqual({
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

  it('shows each flag as an AI addition under Challenge on the level it is about, after any objections it already has', () => {
    const copy = parsed(
      reviewCopy(generated, [
        flag('p1', 'overstated', 'Longer prompts always fail.', ['This fails in practice.']),
        flag('p1-summary', 'unsupported', 'Small models need longer prompts', []),
        flag('p1-summary', 'contradicted', 'Longer prompts work', ['This fails in practice.', 'A naive reading']),
      ]),
    )

    expect(challenges(copy, 'p1')).toEqual(['addition: Overstated: Longer prompts always fail — the passage says “This fails in practice.”'])
    expect(challenges(copy, 'p1-summary')).toEqual([
      'addition: An objection the document already has.',
      'addition: Unsupported: Small models need longer prompts — the passage does not say this',
      'addition: Contradicted: Longer prompts work — the passage says “This fails in practice.” and “A naive reading”',
    ])
  })

  it('says what the passage says only for an unsupported claim with evidence, and keeps a claim’s closing ellipsis', () => {
    const copy = parsed(reviewCopy(generated, [flag('p1', 'unsupported', 'Small models need more context...', ['A naive reading'])]))

    expect(challenges(copy, 'p1')).toEqual(['addition: Unsupported: Small models need more context... — the passage says only “A naive reading”'])
  })

  it('shows a flag on a level within a list operation', () => {
    const document = documentFrom({
      title: 'Derived',
      blocks: [
        [
          {
            id: 'a',
            short: 'A result',
            derive: [{ provenance: 'compression', inlines: [{ id: 'd1', short: 'A step', elaborate: { provenance: 'approved', inlines: [long] } }] }],
          },
        ],
      ],
    })

    expect(challenges(parsed(reviewCopy(document, [flag('d1', 'overstated', 'A claim', ['A naive reading'])])), 'd1')).toEqual([
      'addition: Overstated: A claim — the passage says “A naive reading”',
    ])
  })

  it('fails on a flag about a level the document does not have, rather than lose it', () => {
    expect(() => reviewCopy(generated, [flag('p9', 'overstated', 'A claim', ['A naive reading'])])).toThrow('p9: no such level to flag')
  })
})
