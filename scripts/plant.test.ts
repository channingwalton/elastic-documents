import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '../src/core/document'

const script = fileURLToPath(new URL('./plant.ts', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))

/** A document as the generator writes it: a heading, then a passage with a headline. */
const document = {
  title: 'Execution Classes',
  blocks: [
    { provenance: 'approved', inlines: ['Concept'] },
    {
      provenance: 'compression',
      inlines: [
        {
          id: 'p6',
          short: { provenance: 'compression', text: 'More instruction makes small models worse.' },
          elaborate: { provenance: 'approved', inlines: ['Past a point, more instruction makes small models worse.'] },
        },
      ],
    },
  ],
}

const plants = [{ level: 'p6', text: 'More instruction makes small models better.', error: 'Contradicts the note.' }]

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

describe('npm run plant', () => {
  let dir: string
  /** A document name of this test's own, since the test document goes to this project's generated/ folder. */
  let name: string
  let output: string

  /** Runs the command as `npm run plant` does from `dir`. */
  async function plantWith(...args: string[]): Promise<Run> {
    try {
      const { stdout, stderr } = await promisify(execFile)('node', [script, ...args], { cwd: root, env: { ...process.env, INIT_CWD: dir } })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const { code, stdout, stderr } = error as Run
      return { code, stdout, stderr }
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'elastic-plant-'))
    name = `test ${basename(dir)}`
    output = join(root, 'generated', `${name}.planted.json`)
    await writeFile(join(dir, `${name}.json`), JSON.stringify(document))
    await writeFile(join(dir, 'plants.json'), JSON.stringify(plants))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(output, { force: true })
  })

  it('writes a test document the reader accepts, with its record of what was planted, to this project’s generated/ folder', async () => {
    expect(await plantWith(`${name}.json`, 'plants.json')).toEqual({
      code: 0,
      stdout: `planted 1 error\nwrote ${relative(dir, output)}\n`,
      stderr: '',
    })
    const parsed = parseDocument(JSON.parse(await readFile(output, 'utf8')))
    expect(parsed.ok && parsed.document.planted).toEqual([
      { level: 'p6', original: 'More instruction makes small models worse.', error: 'Contradicts the note.' },
    ])
  })

  it('reports what it cannot plant, and writes nothing', async () => {
    await writeFile(join(dir, 'plants.json'), JSON.stringify([...plants, { ...plants[0], level: 'p9' }]))

    expect(await plantWith(`${name}.json`, 'plants.json')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'plants.json: [1].level: no stretch has the id "p9"\n',
    })
    expect(await exists(output)).toBe(false)
  })

  it('reports a file it cannot read or that is not JSON, a document the reader would reject, and a malformed list', async () => {
    await writeFile(join(dir, 'broken.json'), '{')
    await writeFile(join(dir, 'untitled.json'), JSON.stringify({ blocks: [] }))
    await writeFile(join(dir, 'empty.json'), '[]')

    expect(await plantWith('missing.json', 'plants.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^missing\.json: cannot read: /) })
    expect(await plantWith(`${name}.json`, 'broken.json')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^broken\.json: not JSON: /) })
    expect(await plantWith('untitled.json', 'plants.json')).toEqual({ code: 1, stdout: '', stderr: 'untitled.json: title: expected a non-empty string\n' })
    expect(await plantWith(`${name}.json`, 'empty.json')).toEqual({ code: 1, stdout: '', stderr: 'empty.json: expected at least one error to plant\n' })
  })

  it('says how to use it unless given a document and a list of errors', async () => {
    const usage = { code: 1, stdout: '', stderr: 'usage: npm run plant -- <document.json> <plants.json>\n' }

    expect(await plantWith()).toEqual(usage)
    expect(await plantWith(`${name}.json`)).toEqual(usage)
  })
})
