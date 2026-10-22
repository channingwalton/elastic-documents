import { describe, expect, it } from 'vitest'
import { hasUnapprovedText, parseDocument } from '../core/document'
import { generate, type Compression, type CompressionRequest, type Compressor } from './generate'
import type { Note, NoteItem } from './note'

const short = 'Small models degrade differently.'
const medium =
  'Model-specific prompts couple skills to products that change frequently. They also hide meaningful differences between models of similar size.'
const long =
  'A naive reading of execution classes is "weaker model, longer prompt". This fails in practice. Small models have worse long-context instruction adherence: a 7B model given two thousand words of explicit steps follows them less reliably, not more. Instruction quantity and instruction-following capacity fall together.'

const note = (...items: NoteItem[]): Note => ({ name: 'Execution class', title: 'Execution Classes', items, skipped: [] })
const passage = (text: string): NoteItem => ({ kind: 'passage', text })
const heading = (text: string): NoteItem => ({ kind: 'heading', text })

/** A model that answers from a table, and remembers what it was asked. */
function fakeModel(answer: (request: CompressionRequest) => Compression): Compressor & { readonly requests: CompressionRequest[] } {
  const requests: CompressionRequest[] = []
  return {
    requests,
    compress: async (request) => {
      requests.push(request)
      return answer(request)
    },
  }
}

/** Compresses honestly: a headline and summary quoting the passage's first sentence. */
const faithful = fakeModel(({ passage, levels }) => {
  const first = passage.slice(0, passage.indexOf('.') + 1)
  return {
    headline: { text: 'Prompts tie skills to products', sources: [first] },
    ...(levels.includes('summary') ? { summary: { text: 'Longer prompts make small models worse.', sources: [first, 'This fails in practice.'] } } : {}),
  }
})

describe('generate', () => {
  it('keeps headings and short passages as the author wrote them, without asking the model', async () => {
    const model = fakeModel(() => {
      throw new Error('the model should not be asked')
    })

    expect(await generate(note(heading('Concept'), passage(short)), model)).toEqual({
      ok: true,
      document: {
        title: 'Execution Classes',
        blocks: [
          { provenance: 'approved', inlines: ['Concept'] },
          { provenance: 'approved', inlines: [short] },
        ],
      },
    })
  })

  it('puts a headline above a passage of a few sentences, grounded in the sentences it compresses', async () => {
    const model = fakeModel(() => ({
      headline: { text: 'Model names tie skills to changing products', sources: ['Model-specific prompts couple skills to products that change frequently.'] },
    }))

    expect(await generate(note(heading('Why model names are wrong'), passage(medium)), model)).toEqual({
      ok: true,
      document: {
        title: 'Execution Classes',
        blocks: [
          { provenance: 'approved', inlines: ['Why model names are wrong'] },
          {
            provenance: 'compression',
            inlines: [
              {
                id: 'p1',
                short: { provenance: 'compression', text: 'Model names tie skills to changing products' },
                elaborate: { provenance: 'approved', inlines: [medium] },
                ground: [{ note: 'Execution class', quote: 'Model-specific prompts couple skills to products that change frequently.' }],
              },
            ],
          },
        ],
      },
    })
    expect(model.requests).toEqual([{ title: 'Execution Classes', heading: 'Why model names are wrong', passage: medium, levels: ['headline'] }])
  })

  it('puts a summary between the headline and a long passage', async () => {
    const generated = await generate(note(passage(long)), faithful)

    const first = 'A naive reading of execution classes is "weaker model, longer prompt".'
    expect(generated).toEqual({
      ok: true,
      document: {
        title: 'Execution Classes',
        blocks: [
          {
            provenance: 'compression',
            inlines: [
              {
                id: 'p1',
                short: { provenance: 'compression', text: 'Prompts tie skills to products' },
                elaborate: {
                  provenance: 'compression',
                  inlines: [
                    {
                      id: 'p1-summary',
                      short: { provenance: 'compression', text: 'Longer prompts make small models worse.' },
                      elaborate: { provenance: 'approved', inlines: [long] },
                      ground: [
                        { note: 'Execution class', quote: first },
                        { note: 'Execution class', quote: 'This fails in practice.' },
                      ],
                    },
                  ],
                },
                ground: [{ note: 'Execution class', quote: first }],
              },
            ],
          },
        ],
      },
    })
    expect(faithful.requests.at(-1)).toEqual({ title: 'Execution Classes', passage: long, levels: ['headline', 'summary'] })
  })

  it('numbers the passages it compresses, under the nearest heading', async () => {
    const model = fakeModel(() => ({ headline: { text: 'Headline', sources: ['This fails in practice.'] }, summary: { text: 'Summary', sources: ['This fails in practice.'] } }))

    const generated = await generate(note(heading('One'), passage(long), passage(short), heading('Two'), passage(long)), model)

    if (!generated.ok) throw new Error(generated.errors.join('\n'))
    const ids = JSON.stringify(generated.document).match(/"id":"[^"]+"/g)
    expect(ids).toEqual(['"id":"p1"', '"id":"p1-summary"', '"id":"p3"', '"id":"p3-summary"'])
    expect(model.requests.map((request) => request.heading)).toEqual(['One', 'Two'])
  })

  it('writes a document the reader accepts, marking every generated level as an AI compression', async () => {
    const generated = await generate(note(heading('Concept'), passage(short), passage(medium), passage(long)), faithful)
    if (!generated.ok) throw new Error(generated.errors.join('\n'))

    const parsed = parseDocument(generated.document)

    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.document.blocks.map((block) => block.provenance)).toEqual(['approved', 'approved', 'compression', 'compression'])
    expect(hasUnapprovedText(parsed.document)).toBe(true)
  })

  it('fails when a level quotes anything but the exact text of its passage', async () => {
    const model = fakeModel(() => ({
      headline: { text: 'Bigger prompts fail', sources: ['This fails in practice', 'This  fails in practice.'] },
      summary: { text: 'Small models follow long prompts less well.', sources: ['Small models have worse instruction adherence.'] },
    }))

    expect(await generate(note(passage(long)), model)).toEqual({
      ok: false,
      errors: [
        'p1: the headline quotes text that is not in its passage: "This  fails in practice."',
        'p1: the summary quotes text that is not in its passage: "Small models have worse instruction adherence."',
      ],
    })
  })

  it('fails when a level is missing, blank or quotes nothing', async () => {
    const model = fakeModel(() => ({ headline: { text: ' ', sources: [] } }))

    expect(await generate(note(passage(long)), model)).toEqual({
      ok: false,
      errors: ['p1: the headline is blank', 'p1: the headline quotes nothing from its passage', 'p1: the model wrote no summary'],
    })
  })

  it('fails when the note would make a document the reader rejects', async () => {
    const model = fakeModel(() => {
      throw new Error('the model should not be asked')
    })

    expect(await generate({ ...note(passage('')), title: ' ' }, model)).toEqual({
      ok: false,
      errors: ['title: expected a non-empty string', 'blocks[0].inlines: expected some text'],
    })
  })

  it('fails when a level quotes blank text', async () => {
    const model = fakeModel(() => ({ headline: { text: 'Headline', sources: [' '] } }))

    expect(await generate(note(passage(medium)), model)).toEqual({
      ok: false,
      errors: ['p1: the headline has a blank quote'],
    })
  })
})
