import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import { parseDocument } from '../core/document.ts'
import { inlinePage } from './inline.ts'

/** The reader and a document as one HTML file, or what is wrong with the document. */
export type SingleFile =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly errors: readonly string[] }

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Builds the reader with `json` in place of the sample, in memory, and writes
 * the script and stylesheet it loads into the page.
 */
export async function buildSingleFile(json: unknown): Promise<SingleFile> {
  const parsed = parseDocument(json)
  if (!parsed.ok) return parsed
  const result = await build({ root, base: '/', logLevel: 'silent', plugins: [documentModule(json)], build: { write: false } })
  if (!('output' in result)) throw new Error('expected a single build')
  let html: string | undefined
  const files = new Map<string, string>()
  for (const file of result.output) {
    const text = file.type === 'chunk' ? file.code : typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)
    if (file.fileName === 'index.html') html = text
    else files.set(`/${file.fileName}`, text)
  }
  if (html === undefined) throw new Error('the build made no index.html')
  return { ok: true, html: inlinePage({ html, files }) }
}

const documentId = '\0elastic-document'

/** Serves the document wherever the reader imports `#document`. */
function documentModule(json: unknown): Plugin {
  return {
    name: 'elastic-document',
    enforce: 'pre',
    resolveId: (id) => (id === '#document' ? documentId : undefined),
    load: (id) => (id === documentId ? `export default ${JSON.stringify(json)}` : undefined),
  }
}
