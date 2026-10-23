import { defaultConditions, type Conditions } from './conditions'
import {
  available,
  hasUnapprovedText,
  indexStretches,
  mapStretches,
  type ElasticDocument,
  type IndexedStretch,
  type Operation,
  type Stretch,
} from './document'
import { emptyState, openOperations, showsChips, type ReaderState } from './state'
import { view, type ViewBlock } from './view'

/**
 * What the reader asked for: to activate a phrase, to toggle one of its
 * operations, to open the document to a depth, to show or hide provenance, or
 * to show or hide which statements of a test document are false.
 */
export type Intent =
  | { readonly kind: 'activate'; readonly id: string }
  | { readonly kind: 'toggle'; readonly id: string; readonly operation: Operation }
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'provenance' }
  | { readonly kind: 'reveal' }

type PhraseIntent = Extract<Intent, { readonly kind: 'activate' | 'toggle' }>

export type FocusTarget =
  | { readonly kind: 'phrase' | 'long'; readonly id: string }
  | { readonly kind: 'chip' | 'attachment'; readonly id: string; readonly operation: Operation }
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'provenance' }
  | { readonly kind: 'reveal' }

/**
 * Where focus goes after an intent, and whether a click should leave the page
 * where it is. Content that opens in place keeps still; anything else is
 * brought into view.
 */
export interface Effect {
  readonly focus: FocusTarget
  readonly keepStill: boolean
}

/**
 * The depth the document is open to, and the deepest it can go. No depth is
 * current once the reader has opened or closed phrases so that none matches.
 */
export interface Depth {
  readonly current: number | undefined
  readonly deepest: number
}

/**
 * Whether the page marks provenance, whether the document has any text but
 * approved text to mark, and whether the reader can switch the marking: only
 * when there is something to mark and the study does not fix it.
 */
export interface Marking {
  readonly shown: boolean
  readonly needed: boolean
  readonly switchable: boolean
}

/** A planted statement as the reader sees it, what is wrong with it, and what the generator wrote there. */
export interface PlantedStatement {
  readonly level: string
  readonly text: string
  readonly original: string
  readonly error: string
}

/**
 * What a test document's banner says: how many of its statements are
 * deliberately false, and, once revealed, which. In a study session it says
 * only that the document is a study document, and reveals nothing until the
 * debrief, when the reader opens it without the session.
 */
export type Notice =
  | { readonly planted: number; readonly revealed: false; readonly study: boolean }
  | { readonly planted: number; readonly revealed: true; readonly study: false; readonly statements: readonly PlantedStatement[] }

/** An operation open on a phrase. */
export interface OpenOperation {
  readonly id: string
  readonly operation: Operation
}

/** One thing the reader did in a study session, when, and which operations it opened or closed. */
export interface LogEntry {
  readonly at: string
  readonly intent: Intent
  readonly opened: readonly OpenOperation[]
  readonly closed: readonly OpenOperation[]
}

/** A study session's log: who read which document, under which conditions, from when, and what they did. */
export interface SessionLog {
  readonly session: string
  readonly document: string
  readonly conditions: Omit<Conditions, 'session'>
  readonly started: string
  readonly entries: readonly LogEntry[]
}

export interface Reader {
  readonly view: () => ViewBlock[]
  readonly depth: () => Depth
  readonly marking: () => Marking
  /** The banner of a test document, which the reader cannot dismiss; none for any other document. */
  readonly notice: () => Notice | undefined
  /** What the reader has done in a study session; none outside one. */
  readonly log: () => SessionLog | undefined
  readonly dispatch: (intent: Intent) => Effect | undefined
}

/**
 * A reader of the document, under the study's conditions, if any. In a study
 * session it logs each intent the page acts on, timed by `now`, even one that
 * leaves the page as it was, such as choosing the depth it is already at.
 */
export function createReader(given: ElasticDocument, conditions: Conditions = defaultConditions, now: () => Date = () => new Date()): Reader {
  const document = conditions.operations === 'elaborate' ? elaborateOnly(given) : given
  const stretches = indexStretches(document)
  let deepest = 0
  for (const { stretch, level } of stretches.values()) if (stretch.elaborate) deepest = Math.max(deepest, level)
  const needed = hasUnapprovedText(document)
  const switchable = conditions.provenance === 'switchable' && needed
  let state: ReaderState = { ...emptyState, showProvenance: conditions.provenance !== 'hidden' }
  const { session, operations, provenance } = conditions
  const started = now().toISOString()
  const entries: LogEntry[] = []

  const transition = (intent: Intent): Transition | undefined => {
    if (intent.kind === 'depth') return deepen(stretches, deepest, state, intent.depth)
    if (intent.kind === 'provenance') {
      if (!switchable) return undefined
      return { state: { ...state, showProvenance: !state.showProvenance }, effect: { focus: { kind: 'provenance' }, keepStill: true } }
    }
    if (intent.kind === 'reveal') {
      if (session !== undefined || notice(document, stretches, state, session) === undefined) return undefined
      return { state: { ...state, revealed: !state.revealed }, effect: { focus: { kind: 'reveal' }, keepStill: true } }
    }
    const indexed = stretches.get(intent.id)
    return indexed && apply(indexed.stretch, state, intent)
  }

  return {
    view: () => view(document, state),
    depth: () => ({ current: matchingDepth(stretches, state), deepest }),
    marking: () => ({ shown: state.showProvenance, needed, switchable }),
    notice: () => notice(document, stretches, state, session),
    log: () => (session === undefined ? undefined : { session, document: given.title, conditions: { operations, provenance }, started, entries: [...entries] }),
    dispatch: (intent) => {
      const next = transition(intent)
      if (next === undefined) return undefined
      if (session !== undefined) {
        entries.push({ at: now().toISOString(), intent, opened: openedIn(next.state, state), closed: openedIn(state, next.state) })
      }
      state = next.state
      return next.effect
    },
  }
}

interface Transition {
  readonly state: ReaderState
  readonly effect: Effect
}

/** A session log as a file of JSON, named for the reader and when the session started, so a study's logs sort by reader. */
export function logFile(log: SessionLog): { readonly name: string; readonly text: string } {
  return { name: `elastic-log-${log.session}-${log.started.replace(/[:.]/g, '-')}.json`, text: `${JSON.stringify(log, null, 2)}\n` }
}

/** The operations open in `after` that are not open in `before`. */
function openedIn(after: ReaderState, before: ReaderState): OpenOperation[] {
  return [...after.open].flatMap(([id, operations]) =>
    [...operations].filter((operation) => !openOperations(before, id).has(operation)).map((operation) => ({ id, operation })),
  )
}

/** The document with every operation but Elaborate taken away, for a single "more detail" control. */
function elaborateOnly(document: ElasticDocument): ElasticDocument {
  return mapStretches(document, ({ kind, id, short, elaborate }) => ({ kind, id, short, ...(elaborate === undefined ? {} : { elaborate }) }))
}

/** The banner for the planted errors the reader can reach, which a study condition may have taken some of away; none if it took them all. */
function notice(
  document: ElasticDocument,
  stretches: ReadonlyMap<string, IndexedStretch>,
  state: ReaderState,
  session: string | undefined,
): Notice | undefined {
  const statements = (document.planted ?? []).flatMap(({ level, original, error }) => {
    const found = stretches.get(level)
    return found === undefined ? [] : [{ level, text: found.stretch.short.text, original, error }]
  })
  if (statements.length === 0) return undefined
  const planted = statements.length
  return state.revealed && session === undefined ? { planted, revealed: true, study: false, statements } : { planted, revealed: false, study: session !== undefined }
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
  return { state: { ...state, open }, effect: { focus: { kind: 'depth', depth }, keepStill: true } }
}

/**
 * The depth that every Elaborate is open to exactly, counting those inside
 * closed content, or none. Every level down to the deepest holds an Elaborate,
 * so a depth matches when each open one is shallower than each closed one.
 */
function matchingDepth(stretches: ReadonlyMap<string, IndexedStretch>, state: ReaderState): number | undefined {
  let deepestOpen = 0
  let shallowestClosed = Number.POSITIVE_INFINITY
  for (const { stretch, level } of stretches.values()) {
    if (stretch.elaborate === undefined) continue
    if (openOperations(state, stretch.id).has('elaborate')) deepestOpen = Math.max(deepestOpen, level)
    else shallowestClosed = Math.min(shallowestClosed, level)
  }
  return deepestOpen < shallowestClosed ? deepestOpen : undefined
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
