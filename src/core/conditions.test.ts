import { describe, expect, it } from 'vitest'
import { defaultConditions, parseConditions } from './conditions'

describe('parseConditions', () => {
  it('reads no parameters as every operation, with provenance marking the reader can switch', () => {
    expect(parseConditions('')).toEqual({ ok: true, conditions: defaultConditions })
    expect(parseConditions('?')).toEqual({ ok: true, conditions: { operations: 'all', provenance: 'switchable' } })
  })

  it('limits the operations to Elaborate, and fixes provenance marking shown or hidden', () => {
    expect(parseConditions('?operations=elaborate&provenance=hidden')).toEqual({
      ok: true,
      conditions: { operations: 'elaborate', provenance: 'hidden' },
    })
    expect(parseConditions('?provenance=shown')).toEqual({ ok: true, conditions: { operations: 'all', provenance: 'shown' } })
  })

  it('starts a study session for the reader it names', () => {
    expect(parseConditions('?session=reader-A&operations=elaborate')).toEqual({
      ok: true,
      conditions: { operations: 'elaborate', provenance: 'switchable', session: 'reader-A' },
    })
  })

  it('rejects a session name that could not name a log file', () => {
    expect(parseConditions('?session=reader A')).toEqual({ ok: false, errors: ['session: expected letters, digits, - or _, not "reader A"'] })
    expect(parseConditions('?session')).toEqual({ ok: false, errors: ['session: expected letters, digits, - or _, not ""'] })
  })

  it('rejects a parameter with no value, rather than read it as the default', () => {
    expect(parseConditions('?provenance&operations=')).toEqual({
      ok: false,
      errors: ['provenance: expected "switchable", "shown" or "hidden", not ""', 'operations: expected "all" or "elaborate", not ""'],
    })
  })

  it('accepts the defaults by name, so every link of a study can state its condition', () => {
    expect(parseConditions('?operations=all&provenance=switchable')).toEqual({ ok: true, conditions: defaultConditions })
  })

  it('rejects an unknown parameter or value, and one given twice, so a typo cannot put a reader in the wrong condition', () => {
    expect(parseConditions('?provenence=hidden&operations=some&provenance=off&provenance=shown&operations=')).toEqual({
      ok: false,
      errors: [
        'provenence: unknown parameter',
        'operations: expected "all" or "elaborate", not "some"',
        'provenance: expected "switchable", "shown" or "hidden", not "off"',
        'provenance: given more than once',
        'operations: given more than once',
      ],
    })
  })
})
