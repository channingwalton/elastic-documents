import type { Operation } from './document'

/** What the reader has opened, which phrases show their operation buttons, and how deep the document is open. */
export interface ReaderState {
  readonly open: ReadonlyMap<string, ReadonlySet<Operation>>
  readonly menus: ReadonlySet<string>
  /** The depth the reader last chose, which opened every Elaborate from level 1 down to it and closed the deeper ones. */
  readonly depth: number
}

export const emptyState: ReaderState = { open: new Map(), menus: new Set(), depth: 0 }

const none: ReadonlySet<Operation> = new Set()

export function openOperations(state: ReaderState, id: string): ReadonlySet<Operation> {
  return state.open.get(id) ?? none
}

/** A phrase shows its buttons while the reader has asked for them or has anything open. */
export function showsChips(state: ReaderState, id: string): boolean {
  return state.menus.has(id) || openOperations(state, id).size > 0
}
