import { parseDocument, type ElasticDocument } from './document'

/** Parses a hand-written test document, failing the test if it is invalid. */
export function documentFrom(json: unknown): ElasticDocument {
  const parsed = parseDocument(json)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.document
}
