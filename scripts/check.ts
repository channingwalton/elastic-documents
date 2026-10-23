import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseDocument } from '../src/core/document.ts'
import { checkDocument, verdicts, type Checked } from '../src/generate/check.ts'
import { claudeChecker } from '../src/generate/claude.ts'
import { reviewCopy } from '../src/generate/review.ts'

/** Where the reader ran the command; npm runs scripts from the project root, and says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd()

/** This project's root, whose generated/ folder git ignores. */
const root = fileURLToPath(new URL('..', import.meta.url))

const usage = 'usage: npm run check -- <document.json> [--model <model>]'

/**
 * Checks a generated document's AI compressions against the author's text
 * they compress, with a model judging each claim. Writes a review copy, with
 * every claim not judged supported shown under Challenge, to this project's
 * generated/ folder under the document's name, wherever it is run from, so it
 * never writes into the vault. Returns the exit code.
 */
async function main(argv: readonly string[]): Promise<number> {
  let args: { readonly positionals: readonly string[]; readonly values: { readonly model: string } }
  try {
    args = parseArgs({ args: [...argv], allowPositionals: true, options: { model: { type: 'string', default: 'claude-opus-5-5' } } })
  } catch {
    return fail(usage)
  }
  const [source] = args.positionals
  if (source === undefined) return fail(usage)
  const target = relative(here, join(root, 'generated', `${basename(source, extname(source))}.review.json`))

  let text: string
  try {
    text = await readFile(resolve(here, source), 'utf8')
  } catch (error) {
    return fail(`${source}: cannot read: ${(error as Error).message}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return fail(`${source}: not JSON: ${(error as Error).message}`)
  }
  const parsed = parseDocument(json)
  if (!parsed.ok) return fail(...parsed.errors.map((error) => `${source}: ${error}`))

  let checked: Checked
  try {
    checked = await checkDocument(parsed.document, claudeChecker({ model: args.values.model }))
  } catch (error) {
    return fail(`${source}: ${(error as Error).message}`)
  }
  if (!checked.ok) return fail(...checked.errors.map((error) => `${source}: ${error}`))
  try {
    await mkdir(dirname(resolve(here, target)), { recursive: true })
    await writeFile(resolve(here, target), `${JSON.stringify(reviewCopy(parsed.document, checked.flags), null, 2)}\n`)
  } catch (error) {
    return fail(`${target}: cannot write: ${(error as Error).message}`)
  }
  const claims = checked.levels.flatMap((level) => level.claims)
  const counts = verdicts.map((verdict) => `${claims.filter((claim) => claim.verdict === verdict).length} ${verdict}`)
  console.log(`checked ${checked.levels.length} levels, ${claims.length} claims: ${counts.join(', ')}`)
  console.log(`wrote ${target}`)
  return 0
}

function fail(...lines: readonly string[]): number {
  for (const line of lines) console.error(line)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
