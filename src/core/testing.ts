import { parseDocument, type ElasticDocument } from './document'

/** Parses a hand-written test document, failing the test if it is invalid. */
export function documentFrom(json: unknown): ElasticDocument {
  const parsed = parseDocument(json)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.document
}

/** A test document with planted errors in its two AI headlines, recording the first `count` of them. */
export function testDocument(count: number): ElasticDocument {
  return documentFrom({
    title: 'Tested',
    blocks: [
      {
        provenance: 'compression',
        inlines: [
          {
            id: 'p1',
            short: { provenance: 'compression', text: 'More instruction helps' },
            elaborate: { provenance: 'approved', inlines: ['More instruction hurts.'] },
          },
          ' ',
          {
            id: 'p2',
            short: { provenance: 'compression', text: 'As 2025 benchmarks showed' },
            elaborate: { provenance: 'approved', inlines: ['Capability is uneven.'] },
          },
        ],
      },
    ],
    planted: [
      { level: 'p1', original: 'More instruction hurts', error: 'Contradicts the passage.' },
      { level: 'p2', original: 'Capability is uneven', error: 'The passage names no benchmarks.' },
    ].slice(0, count),
  })
}
