import { indexStretches, type Block, type ElasticDocument, type Inline, type Passage, type Provenance, type ShortForm, type Stretch } from '../core/document.ts'
import type { Flag } from './check.ts'

/** A level or paragraph in the reader's JSON format, always marked, so the copy reads exactly as the document did. */
interface BlockJson {
  readonly provenance: Provenance
  readonly inlines: readonly (string | StretchJson)[]
}

interface StretchJson {
  readonly id: string
  readonly short: ShortForm
  readonly elaborate?: BlockJson
  readonly ground?: readonly Passage[]
  readonly derive?: readonly BlockJson[]
  readonly exemplify?: readonly BlockJson[]
  readonly challenge?: readonly BlockJson[]
  readonly reframe?: readonly BlockJson[]
}

export interface ReviewJson {
  readonly title: string
  readonly blocks: readonly BlockJson[]
}

const verdictLabel: Readonly<Record<Flag['verdict'], string>> = {
  overstated: 'Overstated',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted',
}

/**
 * A copy of the document for its author to review, in the reader's JSON
 * format, with each flag shown under Challenge on the level it is about, after
 * any objections the level already has. The flags are marked as AI additions.
 * Fails on a flag about a level the document does not have, rather than lose it.
 */
export function reviewCopy(document: ElasticDocument, flags: readonly Flag[]): ReviewJson {
  const levels = indexStretches(document)
  const lost = flags.find(({ level }) => !levels.has(level))
  if (lost !== undefined) throw new Error(`${lost.level}: no such level to flag`)
  const objections = new Map<string, BlockJson[]>()
  for (const flag of flags) objections.set(flag.level, [...(objections.get(flag.level) ?? []), objection(flag)])

  const block = ({ provenance, inlines }: Block): BlockJson => ({ provenance, inlines: inlines.map(inline) })
  const inline = (item: Inline): string | StretchJson => (item.kind === 'text' ? item.text : stretch(item))
  const stretch = ({ id, short, elaborate, ground, derive, exemplify, challenge, reframe }: Stretch): StretchJson => {
    const challenges = [...(challenge ?? []).map(block), ...(objections.get(id) ?? [])]
    return {
      id,
      short: { provenance: short.provenance, text: short.text },
      ...(elaborate === undefined ? {} : { elaborate: block(elaborate) }),
      ...(ground === undefined ? {} : { ground: ground.map((passage) => ({ ...passage })) }),
      ...(derive === undefined ? {} : { derive: derive.map(block) }),
      ...(exemplify === undefined ? {} : { exemplify: exemplify.map(block) }),
      ...(challenges.length === 0 ? {} : { challenge: challenges }),
      ...(reframe === undefined ? {} : { reframe: reframe.map(block) }),
    }
  }

  return { title: document.title, blocks: document.blocks.map(block) }
}

/**
 * A flag as the author reads it: the verdict, the claim without its closing
 * full stop, and what the passage says, which for an unsupported claim is all it says.
 */
function objection({ verdict, claim, evidence }: Flag): BlockJson {
  const quoted = evidence.map((quote) => `“${quote}”`)
  const quotes = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : quoted[0]
  const says = quotes === undefined ? 'does not say this' : `says ${verdict === 'unsupported' ? 'only ' : ''}${quotes}`
  return { provenance: 'addition', inlines: [`${verdictLabel[verdict]}: ${claim.trim().replace(/(?<!\.)\.$/, '')} — the passage ${says}`] }
}
