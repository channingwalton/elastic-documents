/** What a study condition lets the reader do, and who is reading in a study session, set from the page's URL. */
export interface Conditions {
  /** Every operation, or Elaborate alone as a single "more detail" control, for study question 1. */
  readonly operations: 'all' | 'elaborate'
  /** Provenance marking the reader can switch, or fixed shown or hidden without the switch, for study question 4. */
  readonly provenance: 'switchable' | 'shown' | 'hidden'
  /** The reader in a study session, whose reading is logged. */
  readonly session?: string
}

export const defaultConditions: Conditions = { operations: 'all', provenance: 'switchable' }

export type ConditionsResult = { readonly ok: true; readonly conditions: Conditions } | { readonly ok: false; readonly errors: readonly string[] }

/**
 * Reads the conditions from a URL's query string: `operations` is `all` or
 * `elaborate`, and `provenance` is `switchable`, `shown` or `hidden`, each
 * the first by default. `session` names the reader in a study session, in
 * letters, digits, `-` and `_`, so it can name the log file. Any other
 * parameter or value, or one given twice, is an error, so a typo cannot put
 * a reader in the wrong condition.
 */
export function parseConditions(search: string): ConditionsResult {
  const errors: string[] = []
  const seen = new Set<string>()
  let conditions: Conditions = defaultConditions
  for (const [key, value] of new URLSearchParams(search)) {
    if (key !== 'operations' && key !== 'provenance' && key !== 'session') {
      errors.push(`${key}: unknown parameter`)
      continue
    }
    if (seen.has(key)) {
      errors.push(`${key}: given more than once`)
      continue
    }
    seen.add(key)
    if (key === 'session') {
      if (/^[\w-]+$/.test(value)) conditions = { ...conditions, session: value }
      else errors.push(`session: expected letters, digits, - or _, not "${value}"`)
    } else if (key === 'operations') {
      if (value === 'all' || value === 'elaborate') conditions = { ...conditions, operations: value }
      else errors.push(`operations: expected "all" or "elaborate", not "${value}"`)
    } else if (value === 'switchable' || value === 'shown' || value === 'hidden') conditions = { ...conditions, provenance: value }
    else errors.push(`provenance: expected "switchable", "shown" or "hidden", not "${value}"`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, conditions }
}
