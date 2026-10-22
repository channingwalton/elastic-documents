import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { buildSingleFile } from '../src/export/build.ts'

/** Where the reader ran the command; npm runs scripts from the project root, and says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd()

/**
 * Writes a document and the reader as one HTML file that opens from disk, by
 * default to exports/ under the document's name. Returns the exit code.
 */
async function main([source, given]: readonly string[]): Promise<number> {
  if (source === undefined) return fail('usage: npm run export -- <document.json> [out.html]')
  const target = given ?? join('exports', `${basename(source, extname(source))}.html`)

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

  const built = await buildSingleFile(json)
  if (!built.ok) return fail(...built.errors.map((error) => `${source}: ${error}`))
  await mkdir(dirname(resolve(here, target)), { recursive: true })
  await writeFile(resolve(here, target), built.html)
  console.log(`wrote ${target}`)
  return 0
}

function fail(...lines: readonly string[]): number {
  for (const line of lines) console.error(line)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
