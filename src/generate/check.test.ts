import { describe, expect, it } from 'vitest'
import { documentFrom } from '../core/testing'
import { checkDocument, scorePlanted, type CheckRequest, type CheckResponse, type Checker, type Flag } from './check'

const long = 'A naive reading of execution classes is "weaker model, longer prompt". This fails in practice.'
const medium = 'Model-specific prompts couple skills to products that change frequently.'
const ground = [{ note: 'Execution class', quote: 'This fails in practice.' }]

/** A document as the generator writes it: a heading, a passage with a headline and summary, and one with a headline. */
const generated = documentFrom({
  title: 'Execution Classes',
  blocks: [
    { provenance: 'approved', inlines: ['Concept'] },
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p1',
          short: { provenance: 'compression', text: 'Longer prompts fail' },
          elaborate: {
            provenance: 'compression',
            inlines: [
              {
                id: 'p1-summary',
                short: { provenance: 'compression', text: 'Longer prompts fail small models.' },
                elaborate: { provenance: 'approved', inlines: [long] },
                ground,
              },
            ],
          },
          ground,
        },
      ],
    },
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p2',
          short: { provenance: 'compression', text: 'Model names tie skills to products' },
          elaborate: { provenance: 'approved', inlines: [medium] },
          ground: [{ note: 'Execution class', quote: medium }],
        },
      ],
    },
  ],
})

/** A checker that answers from a function, and remembers what it was asked. */
function fakeChecker(answer: (request: CheckRequest) => CheckResponse): Checker & { readonly requests: CheckRequest[] } {
  const requests: CheckRequest[] = []
  return {
    requests,
    check: async (request) => {
      requests.push(request)
      return answer(request)
    },
  }
}

/** A checker that judges every level's text as one claim, supported by the passage's first run of the author's text. */
const approving = () =>
  fakeChecker(({ passage, levels }) => ({
    levels: levels.map(({ id, text }) => ({ id, claims: [{ claim: text, verdict: 'supported', evidence: [passage.split(' […] ')[0] ?? ''] }] })),
  }))

describe('checkDocument', () => {
  it('asks once for each passage about every level that compresses it', async () => {
    const checker = approving()

    await checkDocument(generated, checker)

    expect(checker.requests).toEqual([
      {
        passage: long,
        levels: [
          { id: 'p1', text: 'Longer prompts fail' },
          { id: 'p1-summary', text: 'Longer prompts fail small models.' },
        ],
      },
      { passage: medium, levels: [{ id: 'p2', text: 'Model names tie skills to products' }] },
    ])
  })

  it('flags every claim not judged supported, with its level and the passage', async () => {
    const checker = fakeChecker(({ levels }) => ({
      levels: levels.map(({ id, text }) =>
        id === 'p1-summary'
          ? {
              id,
              claims: [
                { claim: 'Longer prompts fail', verdict: 'supported', evidence: ['This fails in practice.'] },
                { claim: 'The failure is limited to small models', verdict: 'unsupported', evidence: [] },
              ],
            }
          : id === 'p2'
            ? { id, claims: [{ claim: text, verdict: 'overstated', evidence: ['couple skills to products that change frequently'] }] }
            : { id, claims: [{ claim: text, verdict: 'supported', evidence: ['This fails in practice.'] }] },
      ),
    }))

    const checked = await checkDocument(generated, checker)

    expect(checked).toMatchObject({
      ok: true,
      flags: [
        {
          level: 'p1-summary',
          text: 'Longer prompts fail small models.',
          passage: long,
          claim: 'The failure is limited to small models',
          verdict: 'unsupported',
          evidence: [],
        },
        {
          level: 'p2',
          text: 'Model names tie skills to products',
          passage: medium,
          claim: 'Model names tie skills to products',
          verdict: 'overstated',
          evidence: ['couple skills to products that change frequently'],
        },
      ],
    })
    expect(checked.ok && checked.levels.map((level) => [level.id, level.claims.length])).toEqual([
      ['p1', 1],
      ['p1-summary', 2],
      ['p2', 1],
    ])
  })

  it('reads a passage with every phrase inside it opened', async () => {
    const nested = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'outer',
              short: 'It stretches',
              elaborate: {
                provenance: 'approved',
                inlines: ['It stretches. A summary opens into ', { id: 'inner', short: 'its detail', elaborate: ['its detail and its sources'] }, '.'],
              },
            },
          ],
        },
      ],
    })

    const checker = approving()

    await checkDocument(nested, checker)

    expect(checker.requests).toEqual([
      { passage: 'It stretches. A summary opens into its detail and its sources.', levels: [{ id: 'outer', text: 'It stretches' }] },
    ])
  })

  it('leaves AI text out of a passage, so the checker cannot quote it as evidence', async () => {
    const mixed = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'outer',
              short: 'Gist',
              elaborate: {
                provenance: 'compression',
                inlines: [
                  'AI joining words ',
                  {
                    id: 'middle',
                    short: 'Middle gist',
                    elaborate: {
                      provenance: 'approved',
                      inlines: [
                        'The author wrote this',
                        { id: 'aside', short: { provenance: 'compression', text: ' for small models only' }, ground: [{ note: 'N', quote: 'this' }] },
                        '.',
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    const checker = approving()

    await checkDocument(mixed, checker)

    expect(checker.requests).toEqual([
      {
        passage: 'The author wrote this […] .',
        levels: [
          { id: 'outer', text: 'Gist' },
          { id: 'middle', text: 'Middle gist' },
        ],
      },
    ])
  })

  it('keeps the author’s short form when its long form is AI text', async () => {
    const wordsAbove = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'outer',
              short: 'Gist',
              elaborate: {
                provenance: 'approved',
                inlines: ['The author says ', { id: 'phrase', short: 'this phrase', elaborate: { provenance: 'compression', inlines: ['an AI rewording'] } }, '.'],
              },
            },
          ],
        },
      ],
    })
    const checker = approving()

    await checkDocument(wordsAbove, checker)

    expect(checker.requests[0]?.passage).toBe('The author says this phrase.')
  })

  it('marks where AI text was left out, and accepts no evidence that spans the gap, even when asked again', async () => {
    const pieces = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'outer',
              short: 'Two points',
              elaborate: {
                provenance: 'compression',
                inlines: [
                  { id: 'a', short: 'One', elaborate: { provenance: 'approved', inlines: ['First point.'] } },
                  ' and also ',
                  { id: 'b', short: 'Two', elaborate: { provenance: 'approved', inlines: ['Second point.'] } },
                ],
              },
            },
          ],
        },
      ],
    })
    const checker = fakeChecker(({ passage, levels }) => ({
      levels: levels.map(({ id }) => ({
        id,
        claims: [{ claim: 'There are points', verdict: 'supported', evidence: id === 'outer' ? ['point. […] Second', 'First point.'] : [passage] }],
      })),
    }))

    const checked = await checkDocument(pieces, checker)

    expect(checker.requests.map((request) => request.passage)).toEqual([
      'First point. […] Second point.',
      'First point.',
      'Second point.',
      'First point. […] Second point.',
    ])
    expect(checked).toEqual({ ok: false, errors: ['outer: the evidence for "There are points" is not in the passage: "point. […] Second"'] })
  })

  it('accepts evidence copied with the space beside a gap, and keeps it without the space', async () => {
    const gapped = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'outer',
              short: 'Two points',
              elaborate: {
                provenance: 'compression',
                inlines: [
                  { id: 'a', short: 'One', elaborate: { provenance: 'approved', inlines: ['Alpha beta gamma.'] } },
                  ' and ',
                  { id: 'b', short: 'Two', elaborate: { provenance: 'approved', inlines: ['Delta epsilon zeta.'] } },
                ],
              },
            },
          ],
        },
      ],
    })
    const checker = fakeChecker(({ passage, levels }) => ({
      levels: levels.map(({ id }) => ({ id, claims: [{ claim: 'It says so', verdict: 'overstated', evidence: id === 'outer' ? ['Alpha beta gamma. ', ' Delta epsilon zeta.'] : [passage] }] })),
    }))

    const checked = await checkDocument(gapped, checker)

    expect(checker.requests[0]?.passage).toBe('Alpha beta gamma. […] Delta epsilon zeta.')
    expect(checked.ok && checked.flags[0]).toMatchObject({ level: 'outer', evidence: ['Alpha beta gamma.', 'Delta epsilon zeta.'] })
  })

  it('keeps apart passages that read the same but have different gaps', async () => {
    const lookalikes = documentFrom({
      title: 'T',
      blocks: [
        { provenance: 'compression', inlines: [{ id: 'one', short: 'One', elaborate: { provenance: 'approved', inlines: ['A […] B'] } }] },
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'two',
              short: 'Two',
              elaborate: {
                provenance: 'compression',
                inlines: [
                  { id: 'x', short: 'X', elaborate: { provenance: 'approved', inlines: ['A'] } },
                  ' and ',
                  { id: 'y', short: 'Y', elaborate: { provenance: 'approved', inlines: ['B'] } },
                ],
              },
            },
          ],
        },
      ],
    })
    const checker = fakeChecker(({ passage, levels }) => ({
      levels: levels.map(({ id }) => ({ id, claims: [{ claim: 'It says so', verdict: 'supported', evidence: [passage] }] })),
    }))

    const checked = await checkDocument(lookalikes, checker)

    expect(checker.requests.map((request) => [request.passage, request.levels.map((level) => level.id)])).toEqual([
      ['A […] B', ['one']],
      ['A […] B', ['two']],
      ['A', ['x']],
      ['B', ['y']],
      ['A […] B', ['two']],
    ])
    expect(checked).toEqual({ ok: false, errors: ['two: the evidence for "It says so" is not in the passage: "A […] B"'] })
  })

  it('fails on a compression that opens into no text by the author, without asking about it', async () => {
    const hollow = documentFrom({
      title: 'T',
      blocks: [{ provenance: 'compression', inlines: [{ id: 'hollow', short: 'Gist', elaborate: ['AI text all the way down'] }] }],
    })
    const checker = approving()

    expect(await checkDocument(hollow, checker)).toEqual({ ok: false, errors: ['hollow: it opens into no text by the author'] })
    expect(checker.requests).toEqual([])
  })

  it('checks only AI compressions with a long form, not the author’s text or AI additions', async () => {
    const checker = fakeChecker(() => {
      throw new Error('the checker should not be asked')
    })
    const nothingToCheck = documentFrom({
      title: 'T',
      blocks: [
        ['The author’s ', { id: 'own', short: 'own phrase', elaborate: ['own phrase, at length'] }, '.'],
        {
          provenance: 'compression',
          inlines: [
            { id: 'grounded', short: 'A claim', ground: [{ note: 'N', quote: 'A claim.' }] },
            ' and ',
            { id: 'example', short: { provenance: 'compression', text: 'an example' }, exemplify: [[{ id: 'added', short: 'more', elaborate: ['more of it'] }]] },
          ],
        },
      ],
    })

    expect(await checkDocument(nothingToCheck, checker)).toEqual({ ok: true, levels: [], flags: [] })
  })

  it('fails unless every piece of evidence is exactly in the passage', async () => {
    const checker = fakeChecker(({ levels }) => ({
      levels: levels.map(({ id, text }) => ({
        id,
        claims: [{ claim: text, verdict: 'supported', evidence: ['This fails in practice', 'This  fails in practice.'] }],
      })),
    }))

    expect(await checkDocument(generated, checker)).toEqual({
      ok: false,
      errors: [
        'p1: the evidence for "Longer prompts fail" is not in the passage: "This  fails in practice."',
        'p1-summary: the evidence for "Longer prompts fail small models." is not in the passage: "This  fails in practice."',
        'p2: the evidence for "Model names tie skills to products" is not in the passage: "This fails in practice"',
        'p2: the evidence for "Model names tie skills to products" is not in the passage: "This  fails in practice."',
      ],
    })
  })

  it('asks once more about a passage the checker slipped on, and keeps the second answer', async () => {
    let asked = 0
    const checker = fakeChecker(({ passage, levels }) => ({
      levels: levels.map(({ id, text }) => ({
        id,
        claims: [{ claim: text, verdict: 'overstated', evidence: [passage === medium && asked++ === 0 ? 'Words the author never wrote' : passage] }],
      })),
    }))

    const checked = await checkDocument(generated, checker)

    expect(checker.requests.map((request) => request.passage)).toEqual([long, medium, medium])
    expect(checked.ok && checked.flags.map((flag) => [flag.level, flag.evidence])).toEqual([
      ['p1', [long]],
      ['p1-summary', [long]],
      ['p2', [medium]],
    ])
  })

  it('fails on evidence of fewer than three words, unless it is the whole of a run of the author’s text', async () => {
    const checker = fakeChecker(({ levels }) => ({
      levels: levels.map(({ id, text }) => ({ id, claims: [{ claim: text, verdict: 'supported', evidence: ['fails in', 'This fails in'] }] })),
    }))
    const short = documentFrom({
      title: 'T',
      blocks: [{ provenance: 'compression', inlines: [{ id: 'short', short: 'Brief', elaborate: { provenance: 'approved', inlines: ['Fails here.'] } }] }],
    })
    const whole = fakeChecker(({ passage, levels }) => ({ levels: levels.map(({ id }) => ({ id, claims: [{ claim: 'It fails', verdict: 'supported', evidence: [passage] }] })) }))

    expect(await checkDocument(generated, checker)).toMatchObject({
      ok: false,
      errors: [
        'p1: the evidence for "Longer prompts fail" is shorter than three words: "fails in"',
        'p1-summary: the evidence for "Longer prompts fail small models." is shorter than three words: "fails in"',
        'p2: the evidence for "Model names tie skills to products" is not in the passage: "fails in"',
        'p2: the evidence for "Model names tie skills to products" is not in the passage: "This fails in"',
      ],
    })
    expect(await checkDocument(short, whole)).toMatchObject({ ok: true })
  })

  it('accepts no run of the author’s text as evidence when it holds no words', async () => {
    const dotted = documentFrom({
      title: 'T',
      blocks: [
        {
          provenance: 'compression',
          inlines: [
            {
              id: 'dotted',
              short: 'Brief',
              elaborate: {
                provenance: 'approved',
                inlines: ['It fails here', { id: 'aside', short: { provenance: 'compression', text: ' sometimes' }, ground: [{ note: 'N', quote: 'here' }] }, '.'],
              },
            },
          ],
        },
      ],
    })
    const checker = fakeChecker(({ levels }) => ({ levels: levels.map(({ id }) => ({ id, claims: [{ claim: 'It fails', verdict: 'supported', evidence: ['.'] }] })) }))

    expect(await checkDocument(dotted, checker)).toEqual({ ok: false, errors: ['dotted: the evidence for "It fails" is shorter than three words: "."'] })
    expect(checker.requests[0]?.passage).toBe('It fails here […] .')
  })

  it('fails when the checker misses a level, judges one twice or one it was not asked about, or finds no claims', async () => {
    const supported = (text: string) => ({ claim: text, verdict: 'supported' as const, evidence: ['This fails in practice.'] })
    const checker = fakeChecker(({ levels }) =>
      levels[0]?.id === 'p1'
        ? { levels: [{ id: 'p1', claims: [supported('a')] }, { id: 'p1', claims: [supported('b')] }, { id: 'p9', claims: [supported('c')] }] }
        : { levels: [{ id: 'p2', claims: [] }] },
    )

    expect(await checkDocument(generated, checker)).toEqual({
      ok: false,
      errors: [
        'p1: the checker judged it more than once',
        'p9: the checker judged a level it was not asked about',
        'p1-summary: the checker did not judge it',
        'p2: the checker found no claims in it',
      ],
    })
  })

  it('fails when a claim is blank, or quotes no evidence for a verdict that needs it', async () => {
    const checker = fakeChecker(({ levels }) => ({
      levels: levels.map(({ id }) => ({
        id,
        claims: [
          { claim: ' ', verdict: 'unsupported', evidence: [] },
          { claim: 'It contradicts', verdict: 'contradicted', evidence: [] },
          { claim: 'It holds', verdict: 'supported', evidence: [' '] },
        ],
      })),
    }))

    const checked = await checkDocument(generated, checker)

    expect(checked.ok ? [] : checked.errors.filter((error) => error.startsWith('p2:'))).toEqual([
      'p2: a claim is blank',
      'p2: the contradicted claim "It contradicts" quotes no evidence',
      'p2: the supported claim "It holds" quotes no evidence',
    ])
  })
})

describe('scorePlanted', () => {
  const planted = [
    { level: 'p1', original: 'Longer prompts help', error: 'Contradicts the passage.' },
    { level: 'p2', original: 'Model names tie skills to products', error: 'Invents a cause.' },
  ]
  const flag = (level: string): Flag => ({ level, text: level, passage: long, claim: 'A claim', verdict: 'contradicted', evidence: ['This fails in practice.'] })

  const checked = (levels: readonly string[], flags: readonly Flag[]) => ({
    levels: levels.map((id) => ({ id, text: id, passage: long, claims: [] })),
    flags,
  })

  it('counts a planted error as flagged when any claim of its level is flagged, and names those missed', () => {
    expect(scorePlanted(planted, checked(['p1', 'p1-summary', 'p2'], [flag('p1'), flag('p1'), flag('p1-summary')]))).toEqual({
      flagged: ['p1'],
      missed: ['p2'],
      unchecked: [],
    })
    expect(scorePlanted(planted, checked(['p1', 'p2'], [flag('p2'), flag('p1')]))).toEqual({ flagged: ['p1', 'p2'], missed: [], unchecked: [] })
  })

  it('names a planted error on a level the check never asked about, rather than count it as missed', () => {
    expect(scorePlanted(planted, checked(['p1'], [flag('p1')]))).toEqual({ flagged: ['p1'], missed: [], unchecked: ['p2'] })
  })
})
