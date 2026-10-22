export interface Text {
  readonly kind: 'text'
  readonly text: string
}

/** The operations whose content is a list of blocks. */
const listOperations = ['derive', 'exemplify', 'challenge', 'reframe'] as const

export type ListOperation = (typeof listOperations)[number]

/** The ways a reader can open a phrase. Elaborate replaces it in place; the others open beneath it. */
export const operations = ['elaborate', 'ground', ...listOperations] as const

export type Operation = (typeof operations)[number]

/** How each operation is named to the reader, and what it reveals. */
export const operationInfo: Readonly<Record<Operation, { readonly label: string; readonly purpose: string }>> = {
  elaborate: { label: 'Elaborate', purpose: 'Add detail' },
  ground: { label: 'Ground', purpose: 'Reveal the sources' },
  derive: { label: 'Derive', purpose: 'Show the intermediate steps' },
  exemplify: { label: 'Exemplify', purpose: 'Make it concrete' },
  challenge: { label: 'Challenge', purpose: 'Show objections and limits' },
  reframe: { label: 'Reframe', purpose: 'Put it another way' },
}

export const isOperation = (value: unknown): value is Operation =>
  typeof value === 'string' && (operations as readonly string[]).includes(value)

/** A passage quoted from a vault note. */
export interface Passage {
  readonly note: string
  readonly date?: string
  readonly quote: string
}

/** A phrase the reader can open, by any operation it has content for. */
export interface Stretch {
  readonly kind: 'stretch'
  readonly id: string
  readonly short: string
  readonly elaborate?: readonly Inline[]
  readonly ground?: readonly Passage[]
  readonly derive?: readonly Block[]
  readonly exemplify?: readonly Block[]
  readonly challenge?: readonly Block[]
  readonly reframe?: readonly Block[]
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
 * object `{ id, short, ...operations }` is a stretch. `elaborate` holds inlines,
 * `ground` holds passages, and each list operation holds blocks, where a string
 * stands for a block of plain text.
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

const stretchFields: ReadonlySet<string> = new Set(['id', 'short', ...operations])

function parseStretch(value: JsonObject, path: string, context: Context): Stretch {
  const { id, short } = value

  if (!hasText(id)) context.errors.push(`${path}.id: expected a non-empty string`)
  else if (/\s/.test(id)) context.errors.push(`${path}.id: expected an id without spaces`)
  else if (context.ids.has(id)) context.errors.push(`${path}.id: duplicate stretch id "${id}"`)
  else context.ids.add(id)

  if (!hasText(short)) context.errors.push(`${path}.short: expected a non-empty string`)

  for (const key of Object.keys(value)) {
    if (!stretchFields.has(key)) context.errors.push(`${path}.${key}: unknown field`)
  }
  if (!operations.some((operation) => value[operation] !== undefined)) {
    context.errors.push(`${path}: expected at least one operation`)
  }

  // Parsed in the fixed order of the operations, so errors come out in that order.
  const content: { -readonly [K in Operation]?: NonNullable<Stretch[K]> } = {}
  for (const operation of operations) {
    const raw = value[operation]
    if (raw === undefined) continue
    const where = `${path}.${operation}`
    if (operation === 'elaborate') content.elaborate = parseInlines(raw, where, context)
    else if (operation === 'ground') content.ground = parsePassages(raw, where, context)
    else content[operation] = parseList(raw, where, context)
  }

  return { kind: 'stretch', id: hasText(id) ? id : '', short: hasText(short) ? short : '', ...content }
}

function parseItems<T>(value: unknown, path: string, context: Context, parse: (item: unknown, path: string) => T[]): T[] {
  if (!Array.isArray(value)) {
    context.errors.push(`${path}: expected an array`)
    return []
  }
  if (value.length === 0) context.errors.push(`${path}: expected at least one item`)
  return value.flatMap((item, i) => parse(item, `${path}[${i}]`))
}

const passageFields: ReadonlySet<string> = new Set(['note', 'quote', 'date'])

function parsePassages(value: unknown, path: string, context: Context): Passage[] {
  return parseItems(value, path, context, (item, itemPath) => {
    if (!isObject(item)) {
      context.errors.push(`${itemPath}: expected a passage object`)
      return []
    }
    const { note, quote, date } = item
    for (const key of Object.keys(item)) {
      if (!passageFields.has(key)) context.errors.push(`${itemPath}.${key}: unknown field`)
    }
    if (!hasText(note)) context.errors.push(`${itemPath}.note: expected a non-empty string`)
    if (!hasText(quote)) context.errors.push(`${itemPath}.quote: expected a non-empty string`)
    if (date !== undefined && !hasText(date)) context.errors.push(`${itemPath}.date: expected a non-empty string`)
    return [
      {
        note: hasText(note) ? note : '',
        quote: hasText(quote) ? quote : '',
        ...(hasText(date) ? { date } : {}),
      },
    ]
  })
}

function parseList(value: unknown, path: string, context: Context): Block[] {
  return parseItems(value, path, context, (item, itemPath) => {
    if (typeof item === 'string') return [{ inlines: parseInlines([item], itemPath, context) }]
    if (Array.isArray(item)) return [{ inlines: parseInlines(item, itemPath, context) }]
    context.errors.push(`${itemPath}: expected a string or an array of inlines`)
    return []
  })
}

/** The operations a stretch has content for, in their fixed order. */
export function available(stretch: Stretch): Operation[] {
  return operations.filter((operation) => stretch[operation] !== undefined)
}

/** How many items an operation holds. Elaborate is a single long form, so it has no count. */
export function count(stretch: Stretch, operation: Operation): number | undefined {
  return operation === 'elaborate' ? undefined : stretch[operation]?.length
}

/** A stretch and its level: 1 in a paragraph, 2 inside the long form of a level-1 stretch, and so on. */
export interface IndexedStretch {
  readonly stretch: Stretch
  readonly level: number
}

/**
 * Every stretch in the document, wherever it is nested, by id. Levels count
 * Elaborate only, so each paragraph opened beneath a phrase starts again at 1.
 */
export function indexStretches(document: ElasticDocument): ReadonlyMap<string, IndexedStretch> {
  const found = new Map<string, IndexedStretch>()
  const visit = (inlines: readonly Inline[], level: number): void => {
    for (const inline of inlines) {
      if (inline.kind === 'text') continue
      found.set(inline.id, { stretch: inline, level })
      visit(inline.elaborate ?? [], level + 1)
      for (const operation of listOperations) for (const block of inline[operation] ?? []) visit(block.inlines, 1)
    }
  }
  for (const block of document.blocks) visit(block.inlines, 1)
  return found
}
