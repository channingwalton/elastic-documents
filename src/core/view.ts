import {
  available,
  count,
  type Block,
  type ElasticDocument,
  type Inline,
  type ListOperation,
  type Operation,
  type Passage,
  type Stretch,
} from './document'
import { openOperations, showsChips, type ReaderState } from './state'

/**
 * A button that toggles one operation on a phrase, or the lone control that
 * collapses an elaborated phrase whose only operation is Elaborate.
 */
export type Chip =
  | { readonly kind: 'toggle'; readonly operation: Operation; readonly count?: number; readonly pressed: boolean }
  | { readonly kind: 'collapse' }

export type ViewInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'phrase'; readonly id: string; readonly text: string; readonly chips: readonly Chip[] }
  | {
      readonly kind: 'long'
      readonly id: string
      readonly short: string
      readonly inlines: readonly ViewInline[]
      readonly chips: readonly Chip[]
    }

/** An operation's content, shown beneath the block that holds its phrase. */
export type ViewAttachment =
  | {
      readonly kind: 'passages'
      readonly id: string
      readonly short: string
      readonly operation: 'ground'
      readonly passages: readonly Passage[]
    }
  | {
      readonly kind: 'blocks'
      readonly id: string
      readonly short: string
      readonly operation: ListOperation
      readonly blocks: readonly ViewBlock[]
    }

export interface ViewBlock {
  readonly inlines: readonly ViewInline[]
  readonly attachments: readonly ViewAttachment[]
}

/**
 * What the reader sees. A phrase inside a closed parent keeps its state, so
 * reopening the parent shows it as the reader left it.
 */
export function view(document: ElasticDocument, state: ReaderState): ViewBlock[] {
  return document.blocks.map((block) => viewBlock(block, state))
}

function viewBlock(block: Block, state: ReaderState): ViewBlock {
  const attachments: ViewAttachment[] = []
  const inlines = visible(block.inlines, state, attachments)
  return { inlines, attachments }
}

/** Collects the attachments of every visible phrase, in document order, into `attachments`. */
function visible(inlines: readonly Inline[], state: ReaderState, attachments: ViewAttachment[]): ViewInline[] {
  const result: ViewInline[] = []
  for (const inline of inlines) {
    if (inline.kind === 'text') {
      result.push(inline)
      continue
    }
    const open = openOperations(state, inline.id)
    const chips = showsChips(state, inline.id) ? chipsFor(inline, open) : []
    attachments.push(...attachmentsFor(inline, open, state))
    result.push(
      inline.elaborate && open.has('elaborate')
        ? { kind: 'long', id: inline.id, short: inline.short, inlines: visible(inline.elaborate, state, attachments), chips }
        : { kind: 'phrase', id: inline.id, text: inline.short, chips },
    )
  }
  return result
}

function chipsFor(stretch: Stretch, open: ReadonlySet<Operation>): Chip[] {
  const operations = available(stretch)
  if (operations.length === 1 && operations[0] === 'elaborate' && open.has('elaborate')) return [{ kind: 'collapse' }]
  return operations.map((operation) => {
    const items = count(stretch, operation)
    return { kind: 'toggle', operation, ...(items === undefined ? {} : { count: items }), pressed: open.has(operation) }
  })
}

function attachmentsFor(stretch: Stretch, open: ReadonlySet<Operation>, state: ReaderState): ViewAttachment[] {
  const { id, short } = stretch
  return available(stretch).flatMap((operation): ViewAttachment[] => {
    if (operation === 'elaborate' || !open.has(operation)) return []
    if (operation === 'ground') return [{ kind: 'passages', id, short, operation, passages: stretch.ground ?? [] }]
    return [{ kind: 'blocks', id, short, operation, blocks: (stretch[operation] ?? []).map((b) => viewBlock(b, state)) }]
  })
}
