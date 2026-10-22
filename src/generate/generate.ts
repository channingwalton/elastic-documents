import { parseDocument, type Provenance } from '../core/document.ts'
import type { Note } from './note'

/** The levels a model writes above a passage, shortest first. */
export type LevelName = 'headline' | 'summary'

/** What the model is asked to compress, and where the passage sits in its note. */
export interface CompressionRequest {
  readonly title: string
  readonly heading?: string
  readonly passage: string
  readonly levels: readonly LevelName[]
}

/** A level the model wrote, and the text of the passage it compresses, quoted exactly. */
export interface Level {
  readonly text: string
  readonly sources: readonly string[]
}

export type Compression = Readonly<Partial<Record<LevelName, Level>>>

/** The port to a language model that writes shorter levels of a passage. */
export interface Compressor {
  compress(request: CompressionRequest): Promise<Compression>
}

/** A level or paragraph in the reader's JSON format, always marked, so a forgotten mark cannot pass as approved. */
interface BlockJson {
  readonly provenance: Provenance
  readonly inlines: readonly (string | StretchJson)[]
}

interface StretchJson {
  readonly id: string
  readonly short: { readonly provenance: Provenance; readonly text: string }
  readonly elaborate: BlockJson
  readonly ground: readonly { readonly note: string; readonly quote: string }[]
}

export interface DocumentJson {
  readonly title: string
  readonly blocks: readonly BlockJson[]
}

export type Generated =
  | { readonly ok: true; readonly document: DocumentJson }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Passages longer than this many words get a headline above them. */
const headlineAbove = 12
/** Passages longer than this many words also get a summary between the headline and the text. */
const summaryAbove = 40

const words = (text: string): number => text.split(/\s+/).filter((word) => word !== '').length

/** A passage the model compresses, or a heading or short passage kept as the author wrote it. */
type Step = { readonly kind: 'kept'; readonly text: string } | { readonly kind: 'compressed'; readonly id: string; readonly request: CompressionRequest }

/**
 * Builds a document from a note: compress, do not invent. The author's text is
 * the deepest level, and the model writes the shorter levels above each
 * passage. Every generated level is marked as an AI compression and grounded
 * in the text it compresses, and fails the build unless each quote is exactly
 * in its passage, or unless the reader would reject the document. Headings
 * and short passages stay as the author wrote them.
 */
export async function generate(note: Note, compressor: Compressor): Promise<Generated> {
  const steps = plan(note)
  const compressions = await Promise.all(steps.map((step) => (step.kind === 'kept' ? undefined : compressor.compress(step.request))))
  const errors: string[] = []
  const blocks = steps.map((step, i): BlockJson => {
    if (step.kind === 'kept') return { provenance: 'approved', inlines: [step.text] }
    const { id, request } = step
    const levels = request.levels.map((name) => ({ name, ...checked(compressions[i]?.[name], name, request.passage, id, errors) }))
    return levels.reduceRight<BlockJson>(
      (within, { name, text, sources }) => ({
        provenance: 'compression',
        inlines: [
          {
            id: name === 'headline' ? id : `${id}-${name}`,
            short: { provenance: 'compression', text },
            elaborate: within,
            ground: sources.map((quote) => ({ note: note.name, quote })),
          },
        ],
      }),
      { provenance: 'approved', inlines: [request.passage] },
    )
  })
  if (errors.length > 0) return { ok: false, errors }
  const document = { title: note.title, blocks }
  const parsed = parseDocument(document)
  return parsed.ok ? { ok: true, document } : parsed
}

/** What to do with each item of the note. Passages are numbered from 1, whether kept or compressed. */
function plan(note: Note): Step[] {
  let heading: string | undefined
  let passages = 0
  return note.items.map((item): Step => {
    if (item.kind === 'heading') {
      heading = item.text
      return { kind: 'kept', text: item.text }
    }
    passages++
    const length = words(item.text)
    if (length <= headlineAbove) return { kind: 'kept', text: item.text }
    const levels: LevelName[] = length > summaryAbove ? ['headline', 'summary'] : ['headline']
    return {
      kind: 'compressed',
      id: `p${passages}`,
      request: { title: note.title, ...(heading === undefined ? {} : { heading }), passage: item.text, levels },
    }
  })
}

/** The level, after recording in `errors` anything that keeps it from compressing `passage` faithfully. */
function checked(level: Level | undefined, name: LevelName, passage: string, id: string, errors: string[]): Level {
  if (level === undefined) {
    errors.push(`${id}: the model wrote no ${name}`)
    return { text: '', sources: [] }
  }
  if (level.text.trim() === '') errors.push(`${id}: the ${name} is blank`)
  if (level.sources.length === 0) errors.push(`${id}: the ${name} quotes nothing from its passage`)
  for (const quote of level.sources) {
    if (quote.trim() === '') errors.push(`${id}: the ${name} has a blank quote`)
    else if (!passage.includes(quote)) errors.push(`${id}: the ${name} quotes text that is not in its passage: "${quote}"`)
  }
  return level
}
