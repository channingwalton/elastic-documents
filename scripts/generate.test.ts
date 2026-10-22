import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '../src/core/document'

const script = fileURLToPath(new URL('./generate.ts', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Stands in for `claude -p`: answers with a headline and, if asked, a summary,
 * each quoting the passage's first sentence, or a misquote when FAKE_CLAUDE
 * says so. The headline names the model it was asked for.
 */
const fakeClaude = `#!/usr/bin/env node
let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const model = args[args.indexOf('--model') + 1]
  const passage = input.slice(input.indexOf('Passage:\\n') + 'Passage:\\n'.length).trim()
  const quote = process.env.FAKE_CLAUDE === 'misquote' ? 'Words the author never wrote.' : passage.slice(0, passage.indexOf('.') + 1)
  const level = (text) => ({ text, sources: [quote] })
  const output = { headline: level('Headline by ' + model) }
  if (input.includes('Levels: headline, summary')) output.summary = level('A summary.')
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: output }))
})
`

const note = `---
aliases: ec
---

# Execution Classes

## Concept

AI skills should target behavioural capability rather than individual model names. Different models need different levels of support.

Short passages stay.

|CLASS|FORM|
|---|---|
|A|Concise|
`

interface Run {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('npm run generate', () => {
  let dir: string
  let bin: string
  /** A note name of this test's own, since the default output goes to this project's generated/ folder. */
  let name: string
  let output: string

  /** Runs the generator as `npm run generate` does from `dir`, with the fake claude first on the path. */
  async function generateWith(env: Readonly<Record<string, string>>, ...args: string[]): Promise<Run> {
    try {
      const { stdout, stderr } = await promisify(execFile)('node', [script, ...args], {
        cwd: root,
        env: { ...process.env, INIT_CWD: dir, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ...env },
      })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const { code, stdout, stderr } = error as Run
      return { code, stdout, stderr }
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'elastic-generate-'))
    bin = join(dir, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'claude'), fakeClaude)
    await chmod(join(bin, 'claude'), 0o755)
    name = `test ${basename(dir)}`
    output = join(root, 'generated', `${name}.json`)
    await writeFile(join(dir, `${name}.md`), note)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(output, { force: true })
  })

  it('builds a document the reader accepts in this project’s generated/ folder, wherever it is run from, and says what it skipped', async () => {
    expect(await generateWith({}, `${name}.md`)).toEqual({
      code: 0,
      stdout: `${name}.md: skipped line 13: a table\nwrote ${relative(dir, output)}\n`,
      stderr: '',
    })
    expect(await exists(join(dir, 'generated'))).toBe(false)
    const parsed = parseDocument(JSON.parse(await readFile(output, 'utf8')))
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.document.title).toBe('Execution Classes')
    expect(parsed.document.blocks.map((block) => block.provenance)).toEqual(['approved', 'compression', 'approved'])
  })

  it('writes where it is told, with the model it is told', async () => {
    const target = join(dir, 'out.json')

    expect(await generateWith({}, `${name}.md`, target, '--model', 'claude-haiku-5-5')).toMatchObject({ code: 0 })
    expect(await readFile(target, 'utf8')).toContain('"text": "Headline by claude-haiku-5-5"')
  })

  it('asks for Sonnet unless told otherwise', async () => {
    await generateWith({}, `${name}.md`)

    expect(await readFile(output, 'utf8')).toContain('"text": "Headline by claude-sonnet-5-5"')
  })

  it('reports quotes that are not in their passage, and writes nothing', async () => {
    expect(await generateWith({ FAKE_CLAUDE: 'misquote' }, `${name}.md`)).toEqual({
      code: 1,
      stdout: `${name}.md: skipped line 13: a table\n`,
      stderr: `${name}.md: p1: the headline quotes text that is not in its passage: "Words the author never wrote."\n`,
    })
    expect(await exists(output)).toBe(false)
  })

  it('reports a failing model, and a note it cannot read', async () => {
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "Not logged in" >&2\nexit 1\n')

    expect(await generateWith({}, `${name}.md`)).toMatchObject({ code: 1, stderr: `${name}.md: claude failed: Not logged in\n` })
    expect(await generateWith({}, 'missing.md')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^missing\.md: cannot read: /) })
  })

  it('reports a document it cannot write', async () => {
    expect(await generateWith({}, `${name}.md`, dir)).toMatchObject({ code: 1, stderr: expect.stringMatching(new RegExp(`^${dir}: cannot write: `)) })
  })

  it('reports a model that exits before reading the passage', async () => {
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "bad flag" >&2\nexit 2\n')
    await writeFile(join(dir, 'Long.md'), `${'word '.repeat(400_000)}\n`)

    expect(await generateWith({}, 'Long.md')).toEqual({ code: 1, stdout: '', stderr: 'Long.md: claude failed: bad flag\n' })
  })

  it('says how to use it when given no note', async () => {
    expect(await generateWith({})).toEqual({ code: 1, stdout: '', stderr: 'usage: npm run generate -- <note.md> [out.json] [--model <model>]\n' })
  })
})
