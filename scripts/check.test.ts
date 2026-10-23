import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '../src/core/document'

const script = fileURLToPath(new URL('./check.ts', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Stands in for `claude -p`: judges each level's text as one claim, with the
 * verdict FAKE_VERDICT names, or supported, quoting the whole passage, or a
 * misquote when FAKE_CLAUDE says so. Each claim names the model it was asked for.
 */
const fakeClaude = `#!/usr/bin/env node
let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const model = args[args.indexOf('--model') + 1]
  const [passage, levels] = input.slice('Passage:\\n'.length).split('\\n\\nLevels:\\n')
  const quote = process.env.FAKE_CLAUDE === 'misquote' ? 'Words the author never wrote' : passage
  const output = {
    levels: levels.trim().split('\\n').map((line) => ({
      id: line.slice(0, line.indexOf(': ')),
      claims: [{ claim: line.slice(line.indexOf(': ') + 2) + ', judged by ' + model, verdict: process.env.FAKE_VERDICT ?? 'supported', evidence: [quote] }],
    })),
  }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: output }))
})
`

const passage = 'AI skills should target behavioural capability rather than individual model names. Different models need different levels of support.'

/** A document as the generator writes it: a heading, then a passage with a headline and a summary. */
const document = {
  title: 'Execution Classes',
  blocks: [
    { provenance: 'approved', inlines: ['Concept'] },
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p1',
          short: { provenance: 'compression', text: 'Target capability, not models' },
          elaborate: {
            provenance: 'compression',
            inlines: [
              {
                id: 'p1-summary',
                short: { provenance: 'compression', text: 'Skills target capability, since models need different support.' },
                elaborate: { provenance: 'approved', inlines: [passage] },
                ground: [{ note: 'Execution Classes', quote: passage }],
              },
            ],
          },
          ground: [{ note: 'Execution Classes', quote: passage }],
        },
      ],
    },
  ],
}

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

describe('npm run check', () => {
  let dir: string
  let bin: string
  /** A document name of this test's own, since the review copy goes to this project's generated/ folder. */
  let name: string
  let output: string

  /** Runs the check as `npm run check` does from `dir`, with the fake claude first on the path. */
  async function checkWith(env: Readonly<Record<string, string>>, ...args: string[]): Promise<Run> {
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
    dir = await mkdtemp(join(tmpdir(), 'elastic-check-'))
    bin = join(dir, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'claude'), fakeClaude)
    await chmod(join(bin, 'claude'), 0o755)
    name = `test ${basename(dir)}`
    output = join(root, 'generated', `${name}.review.json`)
    await writeFile(join(dir, `${name}.json`), JSON.stringify(document))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(output, { force: true })
  })

  it('writes a review copy the reader accepts to this project’s generated/ folder, wherever it is run from, and counts the claims by verdict', async () => {
    expect(await checkWith({}, `${name}.json`)).toEqual({
      code: 0,
      stdout: `checked 2 levels, 2 claims: 2 supported, 0 overstated, 0 unsupported, 0 contradicted\nwrote ${relative(dir, output)}\n`,
      stderr: '',
    })
    expect(await exists(join(dir, 'generated'))).toBe(false)
    expect(parseDocument(JSON.parse(await readFile(output, 'utf8')))).toEqual(parseDocument(document))
  })

  it('shows each claim it flags under Challenge, asking Opus unless told otherwise', async () => {
    expect(await checkWith({ FAKE_VERDICT: 'overstated' }, `${name}.json`)).toMatchObject({
      code: 0,
      stdout: expect.stringMatching(/^checked 2 levels, 2 claims: 0 supported, 2 overstated, 0 unsupported, 0 contradicted\n/),
    })
    const parsed = parseDocument(JSON.parse(await readFile(output, 'utf8')))
    expect(parsed.ok && parsed.document.blocks[1]?.inlines[0]).toMatchObject({
      id: 'p1',
      challenge: [
        {
          provenance: 'addition',
          inlines: [{ kind: 'text', text: `Overstated: Target capability, not models, judged by claude-opus-5-5 — the passage says “${passage}”` }],
        },
      ],
    })

    await checkWith({ FAKE_VERDICT: 'overstated' }, `${name}.json`, '--model', 'claude-sonnet-5-5')
    expect(await readFile(output, 'utf8')).toContain('judged by claude-sonnet-5-5')
  })

  it('says how many of a test document’s planted errors it flagged, names those it missed, and keeps the banner in the review copy', async () => {
    const planted = [{ level: 'p1', original: 'Capability, not model names', error: 'Rewords the headline.' }]
    await writeFile(join(dir, `${name}.json`), JSON.stringify({ ...document, planted }))

    expect(await checkWith({ FAKE_VERDICT: 'overstated' }, `${name}.json`)).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('\nflagged 1 of 1 planted error\nwrote '),
    })
    expect(JSON.parse(await readFile(output, 'utf8')).planted).toEqual(planted)
    expect(await checkWith({}, `${name}.json`)).toMatchObject({ code: 0, stdout: expect.stringContaining('\nflagged 0 of 1 planted error, missing p1\nwrote ') })
  })

  it('says which planted errors are on levels it does not check, rather than count them as missed', async () => {
    const grounded = { id: 'g1', short: { provenance: 'compression', text: 'A claim with only its sources' }, ground: [{ note: 'Execution Classes', quote: passage }] }
    const planted = [
      { level: 'p1', original: 'Capability, not model names', error: 'Rewords the headline.' },
      { level: 'g1', original: 'A claim', error: 'Has no long form to check against.' },
    ]
    await writeFile(join(dir, `${name}.json`), JSON.stringify({ ...document, blocks: [...document.blocks, { provenance: 'compression', inlines: [grounded] }], planted }))

    expect(await checkWith({ FAKE_VERDICT: 'overstated' }, `${name}.json`)).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('\nflagged 1 of 1 planted error; not checked: g1\nwrote '),
    })
  })

  it('reports evidence that is not in the passage, and writes nothing', async () => {
    expect(await checkWith({ FAKE_CLAUDE: 'misquote' }, `${name}.json`)).toEqual({
      code: 1,
      stdout: '',
      stderr: [
        `${name}.json: p1: the evidence for "Target capability, not models, judged by claude-opus-5-5" is not in the passage: "Words the author never wrote"`,
        `${name}.json: p1-summary: the evidence for "Skills target capability, since models need different support., judged by claude-opus-5-5" is not in the passage: "Words the author never wrote"`,
        '',
      ].join('\n'),
    })
    expect(await exists(output)).toBe(false)
  })

  it('reports a document it cannot read, one that is not JSON, one the reader would reject, and a failing model', async () => {
    await writeFile(join(dir, 'broken.json'), '{')
    await writeFile(join(dir, 'untitled.json'), JSON.stringify({ blocks: [] }))

    expect(await checkWith({}, 'missing.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^missing\.json: cannot read: /) })
    expect(await checkWith({}, 'broken.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^broken\.json: not JSON: /) })
    expect(await checkWith({}, 'untitled.json')).toEqual({ code: 1, stdout: '', stderr: 'untitled.json: title: expected a non-empty string\n' })

    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "Not logged in" >&2\nexit 1\n')
    expect(await checkWith({}, `${name}.json`)).toEqual({ code: 1, stdout: '', stderr: `${name}.json: claude failed: Not logged in\n` })
    expect(await exists(output)).toBe(false)
  })

  it('says how to use it when given no document', async () => {
    expect(await checkWith({})).toEqual({ code: 1, stdout: '', stderr: 'usage: npm run check -- <document.json> [--model <model>]\n' })
  })
})
