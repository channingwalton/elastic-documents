import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { claudeCompressor } from '../src/generate/claude.ts'
import { generate, type Generated } from '../src/generate/generate.ts'
import { parseNote } from '../src/generate/note.ts'

/** Where the reader ran the command; npm runs scripts from the project root, and says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd()

/** This project's root, whose generated/ folder git ignores. */
const root = fileURLToPath(new URL('..', import.meta.url))

const usage = 'usage: npm run generate -- <note.md> [out.json] [--model <model>]'

/**
 * Builds a document from one vault note, with a model writing the shorter
 * levels above the note's own text. Writes it by default to this project's
 * generated/ folder under the note's name, wherever it is run from, so it
 * never writes into the vault unless told to. Returns the exit code.
 */
async function main(argv: readonly string[]): Promise<number> {
  let args: { readonly positionals: readonly string[]; readonly values: { readonly model: string } }
  try {
    args = parseArgs({ args: [...argv], allowPositionals: true, options: { model: { type: 'string', default: 'claude-sonnet-5-5' } } })
  } catch {
    return fail(usage)
  }
  const [source, given] = args.positionals
  if (source === undefined) return fail(usage)
  const name = basename(source, extname(source))
  const target = given ?? relative(here, join(root, 'generated', `${name}.json`))

  let text: string
  try {
    text = await readFile(resolve(here, source), 'utf8')
  } catch (error) {
    return fail(`${source}: cannot read: ${(error as Error).message}`)
  }

  const note = parseNote(name, text)
  for (const skipped of note.skipped) console.log(`${source}: skipped ${skipped}`)
  let generated: Generated
  try {
    generated = await generate(note, claudeCompressor({ model: args.values.model }))
  } catch (error) {
    return fail(`${source}: ${(error as Error).message}`)
  }
  if (!generated.ok) return fail(...generated.errors.map((error) => `${source}: ${error}`))
  try {
    await mkdir(dirname(resolve(here, target)), { recursive: true })
    await writeFile(resolve(here, target), `${JSON.stringify(generated.document, null, 2)}\n`)
  } catch (error) {
    return fail(`${target}: cannot write: ${(error as Error).message}`)
  }
  console.log(`wrote ${target}`)
  return 0
}

function fail(...lines: readonly string[]): number {
  for (const line of lines) console.error(line)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
