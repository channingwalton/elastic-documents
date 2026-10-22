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

/** The operations whose content an AI adds, rather than drawing it from the author or a source. */
const addedOperations: readonly Operation[] = ['exemplify', 'challenge', 'reframe']

/**
 * Where a level's text came from: the author, who wrote or approved it; an AI
 * compression of approved text; or an AI addition.
 */
export const provenances = ['approved', 'compression', 'addition'] as const

export type Provenance = (typeof provenances)[number]

/** How each provenance is named to the reader. */
export const provenanceLabel: Readonly<Record<Provenance, string>> = {
  approved: 'Approved',
  compression: 'AI compression',
  addition: 'AI addition',
}

const isProvenance = (value: unknown): value is Provenance =>
  typeof value === 'string' && (provenances as readonly string[]).includes(value)

/** A passage quoted from a vault note. */
export interface Passage {
  readonly note: string
  readonly date?: string
  readonly quote: string
}

/** The text a closed phrase shows, and where it came from. */
export interface ShortForm {
  readonly provenance: Provenance
  readonly text: string
}

/** A phrase the reader can open, by any operation it has content for. Ground passages are always approved. */
export interface Stretch {
  readonly kind: 'stretch'
  readonly id: string
  readonly short: ShortForm
  readonly elaborate?: Block
  readonly ground?: readonly Passage[]
  readonly derive?: readonly Block[]
  readonly exemplify?: readonly Block[]
  readonly challenge?: readonly Block[]
  readonly reframe?: readonly Block[]
}

export type Inline = Text | Stretch

/** Text and stretches from one source: a paragraph, or the long form that replaces a short form. */
export interface Block {
  readonly provenance: Provenance
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
 *
 * A paragraph, short form or long form can be marked with its provenance, as
 * `{ provenance, inlines }` or, for a short form, `{ provenance, text }`. An
 * unmarked one takes the provenance of the level around it, which is approved
 * at the top. Exemplify, Challenge and Reframe content is an addition, and so
 * is every level inside an addition.
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
  return value.map((block, i) => parseBlock(block, `blocks[${i}]`, context, 'approved'))
}

/** An object meant as a marked `{ provenance, inlines }`, rather than, say, a stretch put where an array belongs. */
const isMarkedBlock = (value: unknown): value is JsonObject =>
  isObject(value) && ('provenance' in value || 'inlines' in value)

/** Reads an array of inlines, which takes the provenance around it, or a marked `{ provenance, inlines }`. */
function parseBlock(value: unknown, path: string, context: Context, around: Provenance): Block {
  if (isMarkedBlock(value)) {
    const provenance = parseMark(value, 'inlines', path, context, around)
    return { provenance, inlines: parseInlines(value.inlines, `${path}.inlines`, context, provenance) }
  }
  if (!Array.isArray(value)) {
    context.errors.push(`${path}: expected an array of inlines or { provenance, inlines }`)
    return { provenance: around, inlines: [] }
  }
  return { provenance: around, inlines: parseInlines(value, path, context, around) }
}

/** Reads a string, which takes the provenance around it, or a marked `{ provenance, text }`. */
function parseShort(value: unknown, path: string, context: Context, around: Provenance): ShortForm {
  const [provenance, text] = isObject(value)
    ? [parseMark(value, 'text', path, context, around), value.text]
    : [around, value]
  if (!hasText(text)) context.errors.push(`${isObject(value) ? `${path}.text` : path}: expected a non-empty string`)
  return { provenance, text: hasText(text) ? text : '' }
}

/** Reads the provenance of a marked level whose content is in `field`. Inside an addition, every level is an addition. */
function parseMark(value: JsonObject, field: string, path: string, context: Context, around: Provenance): Provenance {
  rejectUnknownFields(value, new Set(['provenance', field]), path, context)
  const { provenance } = value
  if (!isProvenance(provenance)) {
    context.errors.push(`${path}.provenance: expected "approved", "compression" or "addition"`)
    return around
  }
  if (around === 'addition' && provenance !== 'addition') {
    context.errors.push(`${path}.provenance: expected "addition" inside an addition`)
    return around
  }
  return provenance
}

function rejectUnknownFields(value: JsonObject, fields: ReadonlySet<string>, path: string, context: Context): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) context.errors.push(`${path}.${key}: unknown field`)
  }
}

function parseInlines(value: unknown, path: string, context: Context, around: Provenance): Inline[] {
  if (!Array.isArray(value)) {
    context.errors.push(`${path}: expected an array of inlines`)
    return []
  }
  const inlines = value.flatMap((item, i) => parseInline(item, `${path}[${i}]`, context, around))
  if (!inlines.some(isVisible)) context.errors.push(`${path}: expected some text`)
  return inlines
}

function parseInline(value: unknown, path: string, context: Context, around: Provenance): Inline[] {
  if (typeof value === 'string') return [{ kind: 'text', text: value }]
  if (!isObject(value)) {
    context.errors.push(`${path}: expected a string or a stretch object`)
    return []
  }
  return [parseStretch(value, path, context, around)]
}

const stretchFields: ReadonlySet<string> = new Set(['id', 'short', ...operations])

/** `around` is the provenance of the level the stretch sits in, which its own levels take unless marked. */
function parseStretch(value: JsonObject, path: string, context: Context, around: Provenance): Stretch {
  const { id } = value

  if (!hasText(id)) context.errors.push(`${path}.id: expected a non-empty string`)
  else if (/\s/.test(id)) context.errors.push(`${path}.id: expected an id without spaces`)
  else if (context.ids.has(id)) context.errors.push(`${path}.id: duplicate stretch id "${id}"`)
  else context.ids.add(id)

  const short = parseShort(value.short, `${path}.short`, context, around)

  rejectUnknownFields(value, stretchFields, path, context)
  if (!operations.some((operation) => value[operation] !== undefined)) {
    context.errors.push(`${path}: expected at least one operation`)
  }

  // Parsed in the fixed order of the operations, so errors come out in that order.
  const content: { -readonly [K in Operation]?: NonNullable<Stretch[K]> } = {}
  for (const operation of operations) {
    const raw = value[operation]
    if (raw === undefined) continue
    const where = `${path}.${operation}`
    if (operation === 'elaborate') content.elaborate = parseBlock(raw, where, context, around)
    else if (operation === 'ground') content.ground = parsePassages(raw, where, context)
    else content[operation] = parseList(raw, where, context, addedOperations.includes(operation) ? 'addition' : around)
  }

  return { kind: 'stretch', id: hasText(id) ? id : '', short, ...content }
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
    rejectUnknownFields(item, passageFields, itemPath, context)
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

function parseList(value: unknown, path: string, context: Context, around: Provenance): Block[] {
  return parseItems(value, path, context, (item, itemPath) => {
    if (typeof item === 'string') return [{ provenance: around, inlines: parseInlines([item], itemPath, context, around) }]
    if (Array.isArray(item) || isMarkedBlock(item)) return [parseBlock(item, itemPath, context, around)]
    context.errors.push(`${itemPath}: expected a string, an array of inlines or { provenance, inlines }`)
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

/** Whether any paragraph, short form or long form in the document is something other than approved. */
export function hasUnapprovedText(document: ElasticDocument): boolean {
  const unapproved = (level: { readonly provenance: Provenance }): boolean => level.provenance !== 'approved'
  return (
    document.blocks.some(unapproved) ||
    [...indexStretches(document).values()].some(
      ({ stretch }) =>
        unapproved(stretch.short) ||
        (stretch.elaborate !== undefined && unapproved(stretch.elaborate)) ||
        listOperations.some((operation) => stretch[operation]?.some(unapproved)),
    )
  )
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
      visit(inline.elaborate?.inlines ?? [], level + 1)
      for (const operation of listOperations) for (const block of inline[operation] ?? []) visit(block.inlines, 1)
    }
  }
  for (const block of document.blocks) visit(block.inlines, 1)
  return found
}
