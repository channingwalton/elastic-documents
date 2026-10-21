import type { ElasticDocument, Inline } from './document'

/** The ids of the stretches the reader has opened. */
export type OpenSet = ReadonlySet<string>

export type ViewInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'stretch'; readonly id: string; readonly open: false; readonly text: string }
  | {
      readonly kind: 'stretch'
      readonly id: string
      readonly open: true
      readonly short: string
      readonly inlines: readonly ViewInline[]
    }

export type ViewBlock = readonly ViewInline[]

export function toggle(open: OpenSet, id: string): OpenSet {
  const next = new Set(open)
  if (!next.delete(id)) next.add(id)
  return next
}

/**
 * What the reader sees. A stretch inside a closed parent stays in the open
 * set, so reopening the parent shows it as the reader left it.
 */
export function view(document: ElasticDocument, open: OpenSet): ViewBlock[] {
  return document.blocks.map((block) => visible(block.inlines, open))
}

function visible(inlines: readonly Inline[], open: OpenSet): ViewInline[] {
  return inlines.map((inline): ViewInline => {
    if (inline.kind === 'text') return inline
    return open.has(inline.id)
      ? { kind: 'stretch', id: inline.id, open: true, short: inline.short, inlines: visible(inline.elaborate, open) }
      : { kind: 'stretch', id: inline.id, open: false, text: inline.short }
  })
}
