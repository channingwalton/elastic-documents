export interface Text {
  readonly kind: 'text'
  readonly text: string
}

/** A phrase the reader can open. Its long form replaces the short form in place. */
export interface Stretch {
  readonly kind: 'stretch'
  readonly id: string
  readonly short: string
  readonly elaborate: readonly Inline[]
}

export type Inline = Text | Stretch

export interface Block {
  readonly inlines: readonly Inline[]
}

export interface ElasticDocument {
  readonly title: string
  readonly blocks: readonly Block[]
}

export type ParseResult =
  | { readonly ok: true; readonly document: ElasticDocument }
  | { readonly ok: false; readonly errors: readonly string[] }

interface Context {
  readonly errors: string[]
  readonly ids: Set<string>
}

type JsonObject = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isVisible = (inline: Inline): boolean => inline.kind === 'stretch' || inline.text.trim().length > 0

/**
 * Reads a hand-written document. In the JSON form a string is text and an
 * object `{ id, short, elaborate }` is a stretch; `elaborate` nests the same way.
 */
export function parseDocument(json: unknown): ParseResult {
  if (!isObject(json)) return { ok: false, errors: ['document: expected an object'] }

  const context: Context = { errors: [], ids: new Set() }
  const { title } = json
  if (!hasText(title)) context.errors.push('title: expected a non-empty string')
  const blocks = parseBlocks(json.blocks, context)

  return !hasText(title) || context.errors.length > 0
    ? { ok: false, errors: context.errors }
    : { ok: true, document: { title, blocks } }
}

function parseBlocks(value: unknown, context: Context): Block[] {
  if (!Array.isArray(value)) {
    context.errors.push('blocks: expected an array')
    return []
  }
  return value.map((block, i) => ({ inlines: parseInlines(block, `blocks[${i}]`, context) }))
}

function parseInlines(value: unknown, path: string, context: Context): Inline[] {
  if (!Array.isArray(value)) {
    context.errors.push(`${path}: expected an array of inlines`)
    return []
  }
  const inlines = value.flatMap((item, i) => parseInline(item, `${path}[${i}]`, context))
  if (!inlines.some(isVisible)) context.errors.push(`${path}: expected some text`)
  return inlines
}

function parseInline(value: unknown, path: string, context: Context): Inline[] {
  if (typeof value === 'string') return [{ kind: 'text', text: value }]
  if (!isObject(value)) {
    context.errors.push(`${path}: expected a string or a stretch object`)
    return []
  }
  return [parseStretch(value, path, context)]
}

function parseStretch(value: JsonObject, path: string, context: Context): Stretch {
  const { id, short } = value

  if (!hasText(id)) context.errors.push(`${path}.id: expected a non-empty string`)
  else if (/\s/.test(id)) context.errors.push(`${path}.id: expected an id without spaces`)
  else if (context.ids.has(id)) context.errors.push(`${path}.id: duplicate stretch id "${id}"`)
  else context.ids.add(id)

  if (!hasText(short)) context.errors.push(`${path}.short: expected a non-empty string`)

  return {
    kind: 'stretch',
    id: hasText(id) ? id : '',
    short: hasText(short) ? short : '',
    elaborate: parseInlines(value.elaborate, `${path}.elaborate`, context),
  }
}
