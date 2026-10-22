import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '../src/core/document'

const script = fileURLToPath(new URL('./export.ts', import.meta.url))
const sample = fileURLToPath(new URL('../examples/sample.json', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))

interface Run {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs the export as `npm run export` does when run from `cwd`: from the
 * project root, with INIT_CWD naming where it was run.
 */
async function exportWith(cwd: string, ...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [script, ...args], {
      cwd: root,
      env: { ...process.env, INIT_CWD: cwd },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const { code, stdout, stderr } = error as Run
    return { code, stdout, stderr }
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('npm run export', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'elastic-export-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a document and its reader as one HTML file', async () => {
    const target = join(dir, 'reader.html')

    expect(await exportWith(dir, sample, target)).toEqual({ code: 0, stdout: `wrote ${target}\n`, stderr: '' })
    expect(await readFile(target, 'utf8')).toMatch(/^<!doctype html>[\s\S]*<script type="module">[\s\S]*premises to test/)
  })

  it('writes to exports/ under the document name unless told where', async () => {
    await writeFile(join(dir, 'study.json'), await readFile(sample))

    expect(await exportWith(dir, 'study.json')).toMatchObject({ code: 0, stdout: `wrote ${join('exports', 'study.html')}\n` })
    expect(await exists(join(dir, 'exports', 'study.html'))).toBe(true)
  })

  it('reports what is wrong with an invalid document, and writes nothing', async () => {
    const invalid = { title: 'T', blocks: [[{ id: 'a b', short: '' }]] }
    await writeFile(join(dir, 'invalid.json'), JSON.stringify(invalid))
    const parsed = parseDocument(invalid)
    if (parsed.ok) throw new Error('expected the document to be invalid')

    expect(await exportWith(dir, 'invalid.json', 'out.html')).toEqual({
      code: 1,
      stdout: '',
      stderr: parsed.errors.map((error) => `invalid.json: ${error}\n`).join(''),
    })
    expect(await exists(join(dir, 'out.html'))).toBe(false)
  })

  it('reports a document that is not JSON or cannot be read', async () => {
    await writeFile(join(dir, 'broken.json'), '{ "title": ')

    expect(await exportWith(dir, 'broken.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^broken\.json: not JSON: /) })
    expect(await exportWith(dir, 'missing.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^missing\.json: cannot read: /) })
  })

  it('says how to use it when given no document', async () => {
    expect(await exportWith(dir)).toEqual({ code: 1, stdout: '', stderr: 'usage: npm run export -- <document.json> [out.html]\n' })
  })
})
