import { indexStretches, type Block, type ElasticDocument } from '../core/document.ts'

/** How a claim in a shorter level stands against the passage it compresses. */
export const verdicts = ['supported', 'overstated', 'unsupported', 'contradicted'] as const

export type Verdict = (typeof verdicts)[number]

/** A level to check: the AI-compressed short form of a phrase. */
export interface LevelText {
  readonly id: string
  readonly text: string
}

/** What the checker is asked about: one passage, and the levels that compress it. */
export interface CheckRequest {
  readonly passage: string
  readonly levels: readonly LevelText[]
}

/** A claim a level makes, how the passage bears on it, and the passage text that shows it, quoted exactly. */
export interface Judgement {
  readonly claim: string
  readonly verdict: Verdict
  readonly evidence: readonly string[]
}

export interface CheckResponse {
  readonly levels: readonly { readonly id: string; readonly claims: readonly Judgement[] }[]
}

/** The port to a model that judges a level's claims against the passage it compresses. */
export interface Checker {
  check(request: CheckRequest): Promise<CheckResponse>
}

/** A level, the passage it compresses, and the judgements on its claims. */
export interface LevelCheck extends LevelText {
  readonly passage: string
  readonly claims: readonly Judgement[]
}

/** A claim the passage does not support, with the level that makes it and the passage. */
export interface Flag {
  readonly level: string
  readonly text: string
  readonly passage: string
  readonly claim: string
  readonly verdict: Exclude<Verdict, 'supported'>
  readonly evidence: readonly string[]
}

export type Checked =
  | { readonly ok: true; readonly levels: readonly LevelCheck[]; readonly flags: readonly Flag[] }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * Checks every AI compression in a document against the passage it
 * compresses: the author's text in its long form, with every phrase inside
 * opened and AI text left out, so the checker cannot cite AI text as evidence.
 * Where AI text was left out the passage shows a gap, and no evidence may span
 * it. Levels of one passage are judged together. Every claim not judged supported
 * is flagged. The check fails if a compression opens into no text by the
 * author, or if the checker gets a passage wrong and, asked once more, gets
 * it wrong again: misses a level, finds no claims in one, or quotes as
 * evidence anything not exactly in the passage or shorter than three words.
 * Only the second answer counts. Blank quotes count as no evidence.
 */
export async function checkDocument(document: ElasticDocument, checker: Checker): Promise<Checked> {
  const errors: string[] = []
  const answers = await Promise.all(toCheck(document, errors).map((passage) => ask(passage, checker)))
  errors.push(...answers.flatMap((answer) => answer.errors))
  const levels = answers.flatMap((answer) => answer.levels)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, levels, flags: levels.flatMap(flagsOf) }
}

/** The checker's judgements on one passage, and what it got wrong. If it got anything wrong it is asked once more, and only that answer counts. */
async function ask(passage: ToCheck, checker: Checker): Promise<{ readonly levels: readonly LevelCheck[]; readonly errors: readonly string[] }> {
  const attempt = async () => {
    const errors: string[] = []
    return { levels: judged(passage, await checker.check(passage.request), errors), errors }
  }
  const first = await attempt()
  return first.errors.length === 0 ? first : attempt()
}

/** What the checker is asked about one passage, and the runs of the author's text it is made of. */
interface ToCheck {
  readonly request: CheckRequest
  readonly runs: readonly string[]
}

/** Shown in a passage where AI text was left out between runs of the author's text. */
const gap = ' […] '

/**
 * Each passage that AI compressions open into, with those compressions, in
 * document order, after recording in `errors` any that open into no text by the author.
 */
function toCheck(document: ElasticDocument, errors: string[]): ToCheck[] {
  // Keyed by the runs, not the passage they read as, since the author's own text may hold the gap marker.
  const byRuns = new Map<string, { runs: readonly string[]; levels: LevelText[] }>()
  for (const { stretch } of indexStretches(document).values()) {
    if (stretch.short.provenance !== 'compression' || stretch.elaborate === undefined) continue
    const runs = authorsRuns(stretch.elaborate)
    if (runs.length === 0) {
      errors.push(`${stretch.id}: it opens into no text by the author`)
      continue
    }
    const key = JSON.stringify(runs)
    byRuns.set(key, { runs, levels: [...(byRuns.get(key)?.levels ?? []), { id: stretch.id, text: stretch.short.text }] })
  }
  return [...byRuns.values()].map(({ runs, levels }) => ({ request: { passage: runs.join(gap), levels }, runs }))
}

/** A piece of the author's text, or `undefined` where AI text was left out. */
type Piece = string | undefined

/**
 * The runs of the author's text in a level, with every phrase in it opened all
 * the way down. AI text is left out, and ends a run. A phrase whose short form
 * is the author's and whose long form is not keeps its short form.
 */
function authorsRuns(block: Block): string[] {
  const runs: string[] = []
  let run = ''
  for (const piece of [...pieces(block), undefined]) {
    if (piece !== undefined) run += piece
    else if (run.trim() !== '') {
      runs.push(run.trim())
      run = ''
    }
  }
  return runs
}

function pieces(block: Block): Piece[] {
  return block.inlines.flatMap((inline): Piece[] => {
    if (inline.kind === 'text') return [block.provenance === 'approved' ? inline.text : undefined]
    const { short, elaborate } = inline
    const authorAbove = short.provenance === 'approved' && elaborate?.provenance !== 'approved'
    if (elaborate !== undefined && !authorAbove) return pieces(elaborate)
    return [short.provenance === 'approved' ? short.text : undefined]
  })
}

/** The levels asked about with the checker's judgements, after recording in `errors` what the checker got wrong. */
function judged({ request, runs }: ToCheck, response: CheckResponse, errors: string[]): LevelCheck[] {
  const asked = new Set(request.levels.map((level) => level.id))
  const claimsOf = new Map<string, readonly Judgement[]>()
  for (const { id, claims } of response.levels) {
    if (!asked.has(id)) errors.push(`${id}: the checker judged a level it was not asked about`)
    else if (claimsOf.has(id)) errors.push(`${id}: the checker judged it more than once`)
    else claimsOf.set(id, claims)
  }
  return request.levels.flatMap(({ id, text }) => {
    const claims = claimsOf.get(id)
    if (claims === undefined) {
      errors.push(`${id}: the checker did not judge it`)
      return []
    }
    if (claims.length === 0) errors.push(`${id}: the checker found no claims in it`)
    return [{ id, text, passage: request.passage, claims: claims.map((judgement) => checked(judgement, id, runs, errors)) }]
  })
}

/** Evidence shorter than this many words shows nothing, unless it is the whole of a run of the author's text with a word in it. */
const fewestWords = 3

/** How many words `text` has, not counting punctuation that stands alone. */
const words = (text: string): number => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

/**
 * A judgement with its quotes trimmed and blank ones dropped, after recording
 * in `errors` a blank claim, missing evidence, or a quote not exactly within
 * one run of the passage, or too short.
 */
function checked({ claim, verdict, evidence }: Judgement, id: string, runs: readonly string[], errors: string[]): Judgement {
  const quotes = evidence.map((quote) => quote.trim()).filter((quote) => quote !== '')
  if (claim.trim() === '') errors.push(`${id}: a claim is blank`)
  else if (verdict !== 'unsupported' && quotes.length === 0) errors.push(`${id}: the ${verdict} claim "${claim}" quotes no evidence`)
  for (const quote of quotes) {
    if (!runs.some((run) => run.includes(quote))) errors.push(`${id}: the evidence for "${claim}" is not in the passage: "${quote}"`)
    else if (words(quote) < fewestWords && !(words(quote) > 0 && runs.includes(quote))) errors.push(`${id}: the evidence for "${claim}" is shorter than three words: "${quote}"`)
  }
  return { claim, verdict, evidence: quotes }
}

function flagsOf({ id, text, passage, claims }: LevelCheck): Flag[] {
  return claims.flatMap(({ claim, verdict, evidence }) =>
    verdict === 'supported' ? [] : [{ level: id, text, passage, claim, verdict, evidence }],
  )
}
