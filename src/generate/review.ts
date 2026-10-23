import { indexStretches, mapStretches, toJson, type Block, type DocumentJson, type ElasticDocument } from '../core/document.ts'
import type { Flag } from './check.ts'

const verdictLabel: Readonly<Record<Flag['verdict'], string>> = {
  overstated: 'Overstated',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted',
}

/**
 * A copy of the document for its author to review, in the reader's JSON
 * format, with each flag shown under Challenge on the level it is about, after
 * any objections the level already has. The flags are marked as AI additions.
 * A test document's copy keeps the record of its planted errors, and so its banner.
 * Fails on a flag about a level the document does not have, rather than lose it.
 */
export function reviewCopy(document: ElasticDocument, flags: readonly Flag[]): DocumentJson {
  const levels = indexStretches(document)
  const lost = flags.find(({ level }) => !levels.has(level))
  if (lost !== undefined) throw new Error(`${lost.level}: no such level to flag`)
  const objections = new Map<string, Block[]>()
  for (const flag of flags) objections.set(flag.level, [...(objections.get(flag.level) ?? []), objection(flag)])
  return toJson(
    mapStretches(document, (stretch) => {
      const added = objections.get(stretch.id)
      return added === undefined ? stretch : { ...stretch, challenge: [...(stretch.challenge ?? []), ...added] }
    }),
  )
}

/**
 * A flag as the author reads it: the verdict, the claim without its closing
 * full stop, and what the passage says, which for an unsupported claim is all it says.
 */
function objection({ verdict, claim, evidence }: Flag): Block {
  const quoted = evidence.map((quote) => `“${quote}”`)
  const quotes = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : quoted[0]
  const says = quotes === undefined ? 'does not say this' : `says ${verdict === 'unsupported' ? 'only ' : ''}${quotes}`
  return { provenance: 'addition', inlines: [{ kind: 'text', text: `${verdictLabel[verdict]}: ${claim.trim().replace(/(?<!\.)\.$/, '')} — the passage ${says}` }] }
}
