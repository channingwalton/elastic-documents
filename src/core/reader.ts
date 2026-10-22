import { available, stretchesById, type ElasticDocument, type Operation, type Stretch } from './document'
import { emptyState, openOperations, showsChips, type ReaderState } from './state'
import { view, type ViewBlock } from './view'

/** What the reader asked for: to activate a phrase, or to toggle one of its operations. */
export type Intent =
  | { readonly kind: 'activate'; readonly id: string }
  | { readonly kind: 'toggle'; readonly id: string; readonly operation: Operation }

export type FocusTarget =
  | { readonly kind: 'phrase' | 'long'; readonly id: string }
  | { readonly kind: 'chip' | 'attachment'; readonly id: string; readonly operation: Operation }

/**
 * Where focus goes after an intent, and whether a click should leave the page
 * where it is. Content that opens in place keeps still; anything else is
 * brought into view.
 */
export interface Effect {
  readonly focus: FocusTarget
  readonly keepStill: boolean
}

export interface Reader {
  readonly view: () => ViewBlock[]
  readonly dispatch: (intent: Intent) => Effect | undefined
}

export function createReader(document: ElasticDocument): Reader {
  const stretches = stretchesById(document)
  let state = emptyState

  return {
    view: () => view(document, state),
    dispatch: (intent) => {
      const stretch = stretches.get(intent.id)
      const transition = stretch && apply(stretch, state, intent)
      if (transition) state = transition.state
      return transition?.effect
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
function apply(stretch: Stretch, state: ReaderState, intent: Intent): Transition | undefined {
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

function withOpen(state: ReaderState, id: string, operations: ReadonlySet<Operation>): ReaderState {
  const open = new Map(state.open)
  if (operations.size > 0) open.set(id, operations)
  else open.delete(id)
  return { ...state, open }
}

function withMenu(state: ReaderState, id: string, shown: boolean): ReaderState {
  const menus = new Set(state.menus)
  if (shown) menus.add(id)
  else menus.delete(id)
  return { ...state, menus }
}
