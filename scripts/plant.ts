import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from '../src/core/document.ts'
import { parsePlants, plant } from '../src/generate/plant.ts'

/** Where the reader ran the command; npm runs scripts from the project root, and says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd()

/** This project's root, whose generated/ folder git ignores. */
const root = fileURLToPath(new URL('..', import.meta.url))

const usage = 'usage: npm run plant -- <document.json> <plants.json>'

/**
 * Plants deliberate errors in a document, to test readers or the checker, from
 * a list of `{ level, text, error }`. Writes the test document, which the
 * reader opens with a banner saying how many of its statements are false, to
 * this project's generated/ folder as <name>.planted.json, wherever it is run
 * from, so it never writes into the vault. Returns the exit code.
 */
async function main(argv: readonly string[]): Promise<number> {
  const [source, list] = argv
  if (source === undefined || list === undefined || argv.length > 2) return fail(usage)
  const target = relative(here, join(root, 'generated', `${basename(source, extname(source))}.planted.json`))

  const document = await readJson(source)
  if (!document.ok) return fail(document.error)
  const plants = await readJson(list)
  if (!plants.ok) return fail(plants.error)

  const parsed = parseDocument(document.json)
  if (!parsed.ok) return fail(...parsed.errors.map((error) => `${source}: ${error}`))
  const read = parsePlants(plants.json)
  if (!read.ok) return fail(...read.errors.map((error) => `${list}: ${error}`))
  const planted = plant(parsed.document, read.plants)
  if (!planted.ok) return fail(...planted.errors.map((error) => `${list}: ${error}`))

  try {
    await mkdir(dirname(resolve(here, target)), { recursive: true })
    await writeFile(resolve(here, target), `${JSON.stringify(planted.document, null, 2)}\n`)
  } catch (error) {
    return fail(`${target}: cannot write: ${(error as Error).message}`)
  }
  console.log(`planted ${read.plants.length} ${read.plants.length === 1 ? 'error' : 'errors'}`)
  console.log(`wrote ${target}`)
  return 0
}

/** The JSON in a file, or what kept it from being read. */
async function readJson(path: string): Promise<{ readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly error: string }> {
  let text: string
  try {
    text = await readFile(resolve(here, path), 'utf8')
  } catch (error) {
    return { ok: false, error: `${path}: cannot read: ${(error as Error).message}` }
  }
  try {
    return { ok: true, json: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `${path}: not JSON: ${(error as Error).message}` }
  }
}

function fail(...lines: readonly string[]): number {
  for (const line of lines) console.error(line)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
