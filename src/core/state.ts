import type { Operation } from './document'

/** What the reader has opened, and which phrases show their operation buttons. */
export interface ReaderState {
  readonly open: ReadonlyMap<string, ReadonlySet<Operation>>
  readonly menus: ReadonlySet<string>
}

export const emptyState: ReaderState = { open: new Map(), menus: new Set() }

const none: ReadonlySet<Operation> = new Set()

export function openOperations(state: ReaderState, id: string): ReadonlySet<Operation> {
  return state.open.get(id) ?? none
}

/** A phrase shows its buttons while the reader has asked for them or has anything open. */
export function showsChips(state: ReaderState, id: string): boolean {
  return state.menus.has(id) || openOperations(state, id).size > 0
}
