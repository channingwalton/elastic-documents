import { indexStretches, mapStretches, parseDocument, toJson, type DocumentJson, type ElasticDocument, type PlantedError } from '../core/document.ts'

/** A deliberate error to plant: the level it goes in, what that level is to say, and what is wrong with it. */
export interface Plant {
  readonly level: string
  readonly text: string
  readonly error: string
}

export type Planted = { readonly ok: true; readonly document: DocumentJson } | { readonly ok: false; readonly errors: readonly string[] }

/**
 * A test document: each error put in place of a level's short form, which
 * stays marked as AI text, and recorded with what the level said and what is
 * wrong, so the reader shows the document's banner and can reveal which
 * statements are false. Fails on a level of the author's text, one the
 * document lacks or has planted already, or text the level already says,
 * give or take surrounding spaces, and unless the reader accepts the result.
 */
export function plant(document: ElasticDocument, plants: readonly Plant[]): Planted {
  const stretches = indexStretches(document)
  const taken = new Set((document.planted ?? []).map(({ level }) => level))
  const texts = new Map<string, string>()
  const records: PlantedError[] = []
  const errors: string[] = []
  plants.forEach(({ level, text, error }, i) => {
    const found = stretches.get(level)?.stretch
    const wanted = text.trim()
    if (found === undefined) errors.push(`[${i}].level: no stretch has the id "${level}"`)
    else if (found.short.provenance === 'approved') errors.push(`[${i}].level: expected AI text, since an error planted in the author’s text would show as theirs`)
    else if (taken.has(level)) errors.push(`[${i}].level: "${level}" is planted already`)
    else if (wanted === found.short.text.trim()) errors.push(`[${i}].text: the level already says this`)
    else {
      taken.add(level)
      texts.set(level, wanted)
      records.push({ level, original: found.short.text, error })
    }
  })
  if (errors.length > 0) return { ok: false, errors }

  const json = toJson({
    ...mapStretches(document, (stretch) => {
      const text = texts.get(stretch.id)
      return text === undefined ? stretch : { ...stretch, short: { ...stretch.short, text } }
    }),
    planted: [...(document.planted ?? []), ...records],
  })
  const parsed = parseDocument(json)
  return parsed.ok ? { ok: true, document: json } : parsed
}

const plantFields: ReadonlySet<string> = new Set(['level', 'text', 'error'])

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads a list of errors to plant, each `{ level, text, error }`, naming the path of every malformed entry. */
export function parsePlants(json: unknown): { readonly ok: true; readonly plants: readonly Plant[] } | { readonly ok: false; readonly errors: readonly string[] } {
  if (!Array.isArray(json)) return { ok: false, errors: ['expected an array of { level, text, error }'] }
  if (json.length === 0) return { ok: false, errors: ['expected at least one error to plant'] }
  const errors: string[] = []
  const plants = json.flatMap((item: unknown, i): Plant[] => {
    if (!isObject(item)) {
      errors.push(`[${i}]: expected { level, text, error }`)
      return []
    }
    for (const key of Object.keys(item)) if (!plantFields.has(key)) errors.push(`[${i}].${key}: unknown field`)
    const [level = '', text = '', error = ''] = (['level', 'text', 'error'] as const).map((field) => {
      const value = item[field]
      if (typeof value === 'string' && value.trim() !== '') return value
      errors.push(`[${i}].${field}: expected a non-empty string`)
      return ''
    })
    return [{ level, text, error }]
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, plants }
}
