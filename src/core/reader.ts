import {
  available,
  hasUnapprovedText,
  indexStretches,
  type ElasticDocument,
  type IndexedStretch,
  type Operation,
  type Stretch,
} from './document'
import { emptyState, openOperations, showsChips, type ReaderState } from './state'
import { view, type ViewBlock } from './view'

/**
 * What the reader asked for: to activate a phrase, to toggle one of its
 * operations, to open the document to a depth, or to show or hide provenance.
 */
export type Intent =
  | { readonly kind: 'activate'; readonly id: string }
  | { readonly kind: 'toggle'; readonly id: string; readonly operation: Operation }
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'provenance' }

type PhraseIntent = Extract<Intent, { readonly kind: 'activate' | 'toggle' }>

export type FocusTarget =
  | { readonly kind: 'phrase' | 'long'; readonly id: string }
  | { readonly kind: 'chip' | 'attachment'; readonly id: string; readonly operation: Operation }
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'provenance' }

/**
 * Where focus goes after an intent, and whether a click should leave the page
 * where it is. Content that opens in place keeps still; anything else is
 * brought into view.
 */
export interface Effect {
  readonly focus: FocusTarget
  readonly keepStill: boolean
}

/** The depth the document is open to, and the deepest it can go. */
export interface Depth {
  readonly current: number
  readonly deepest: number
}

/** Whether the page marks provenance, and whether the document has any text but approved text to mark. */
export interface Marking {
  readonly shown: boolean
  readonly needed: boolean
}

export interface Reader {
  readonly view: () => ViewBlock[]
  readonly depth: () => Depth
  readonly marking: () => Marking
  readonly dispatch: (intent: Intent) => Effect | undefined
}

export function createReader(document: ElasticDocument): Reader {
  const stretches = indexStretches(document)
  let deepest = 0
  for (const { stretch, level } of stretches.values()) if (stretch.elaborate) deepest = Math.max(deepest, level)
  const needed = hasUnapprovedText(document)
  let state = emptyState

  const transition = (intent: Intent): Transition | undefined => {
    if (intent.kind === 'depth') return deepen(stretches, deepest, state, intent.depth)
    if (intent.kind === 'provenance') {
      return { state: { ...state, showProvenance: !state.showProvenance }, effect: { focus: { kind: 'provenance' }, keepStill: true } }
    }
    const indexed = stretches.get(intent.id)
    return indexed && apply(indexed.stretch, state, intent)
  }

  return {
    view: () => view(document, state),
    depth: () => ({ current: state.depth, deepest }),
    marking: () => ({ shown: state.showProvenance, needed }),
    dispatch: (intent) => {
      const next = transition(intent)
      if (next) state = next.state
      return next?.effect
    },
  }
}

interface Transition {
  readonly state: ReaderState
  readonly effect: Effect
}

/**
 * Activating a closed phrase opens its only operation, or shows its buttons
 * when it has several. Activating a phrase with anything open closes it all.
 */
function apply(stretch: Stretch, state: ReaderState, intent: PhraseIntent): Transition | undefined {
  const { id } = stretch
  const operations = available(stretch)

  if (intent.kind === 'toggle') {
    if (!operations.includes(intent.operation)) return undefined
    return openOperations(state, id).has(intent.operation)
      ? close(state, id, intent.operation)
      : open(state, id, intent.operation)
  }

  const [first] = operations
  if (first === undefined) return undefined
  if (openOperations(state, id).size > 0) {
    return { state: withMenu(withOpen(state, id, new Set()), id, false), effect: { focus: { kind: 'phrase', id }, keepStill: false } }
  }
  if (operations.length === 1) return open(state, id, first)
  return state.menus.has(id)
    ? { state: withMenu(state, id, false), effect: { focus: { kind: 'phrase', id }, keepStill: true } }
    : { state: withMenu(state, id, true), effect: { focus: { kind: 'chip', id, operation: first }, keepStill: true } }
}

function open(state: ReaderState, id: string, operation: Operation): Transition {
  return {
    state: withOpen(state, id, new Set([...openOperations(state, id), operation])),
    effect:
      operation === 'elaborate'
        ? { focus: { kind: 'long', id }, keepStill: true }
        : { focus: { kind: 'attachment', id, operation }, keepStill: false },
  }
}

function close(state: ReaderState, id: string, operation: Operation): Transition {
  const remaining = new Set(openOperations(state, id))
  remaining.delete(operation)
  const next = withOpen(state, id, remaining)
  return {
    state: next,
    effect: { focus: showsChips(next, id) ? { kind: 'chip', id, operation } : { kind: 'phrase', id }, keepStill: false },
  }
}

/**
 * Opens every Elaborate down to the depth and closes those below it, replacing
 * whatever the reader opened or closed by hand. Other operations stay as they are.
 */
function deepen(
  stretches: ReadonlyMap<string, IndexedStretch>,
  deepest: number,
  state: ReaderState,
  depth: number,
): Transition | undefined {
  if (!Number.isInteger(depth) || depth < 0 || depth > deepest) return undefined
  const open = new Map(state.open)
  for (const { stretch, level } of stretches.values()) {
    if (stretch.elaborate === undefined) continue
    const operations = new Set(openOperations(state, stretch.id))
    if (level <= depth) operations.add('elaborate')
    else operations.delete('elaborate')
    put(open, stretch.id, operations)
  }
  return { state: { ...state, open, depth }, effect: { focus: { kind: 'depth', depth }, keepStill: true } }
}

function withOpen(state: ReaderState, id: string, operations: ReadonlySet<Operation>): ReaderState {
  const open = new Map(state.open)
  put(open, id, operations)
  return { ...state, open }
}

function put(open: Map<string, ReadonlySet<Operation>>, id: string, operations: ReadonlySet<Operation>): void {
  if (operations.size > 0) open.set(id, operations)
  else open.delete(id)
}

function withMenu(state: ReaderState, id: string, shown: boolean): ReaderState {
  const menus = new Set(state.menus)
  if (shown) menus.add(id)
  else menus.delete(id)
  return { ...state, menus }
}
