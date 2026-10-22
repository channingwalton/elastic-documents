import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Compression, CompressionRequest, Compressor, LevelName } from './generate'

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs a command with `input` on its standard input. */
export type Run = (command: string, args: readonly string[], input: string) => Promise<RunResult>

export interface ClaudeOptions {
  /** A model id or alias that `claude --model` accepts. */
  readonly model: string
  /** How many calls to run at once. */
  readonly concurrency?: number
  readonly run?: Run
}

const instructions = `You write the shorter levels of an elastic document, which a reader opens from a headline down to the author's own words.

Compress, do not invent: say only what the passage says, in fewer words, and add nothing it does not state. Write in British English.

For each level, also give its sources: the parts of the passage that the level compresses. Copy each one exactly, character for character, as one unbroken run of the passage's text. Do not change its punctuation, spelling, capitals or spacing, and do not join separate parts with an ellipsis.

The levels:
- headline: the passage's main point as a short sentence of at most 10 words.
- summary: the passage in one sentence of at most 25 words, keeping its main claims.`

const levelSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
  required: ['text', 'sources'],
  additionalProperties: false,
}

const schema = (levels: readonly LevelName[]) => ({
  type: 'object',
  properties: Object.fromEntries(levels.map((level) => [level, levelSchema])),
  required: levels,
  additionalProperties: false,
})

const prompt = ({ title, heading, passage, levels }: CompressionRequest): string =>
  [`Note: ${title}`, ...(heading === undefined ? [] : [`Section: ${heading}`]), `Levels: ${levels.join(', ')}`, '', 'Passage:', passage, ''].join('\n')

/**
 * The model behind `claude -p`: Claude Code run headless, answering in a
 * schema, with no tools and none of the user's settings or instructions, so
 * nothing but the passage shapes what it writes. Once a call fails the build
 * fails, so the calls still waiting fail at once rather than run.
 */
export function claudeCompressor({ model, concurrency = 4, run = runProcess }: ClaudeOptions): Compressor {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive whole number, not ${concurrency}`)
  }
  const limited = limit(concurrency)
  let failure: unknown
  return {
    compress: (request) =>
      limited(async () => {
        if (failure !== undefined) throw failure
        const args = [
          '-p',
          '--model',
          model,
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(schema(request.levels)),
          '--system-prompt',
          instructions,
          '--tools',
          '',
          '--setting-sources',
          '',
          '--strict-mcp-config',
          '--no-session-persistence',
        ]
        try {
          return compression(await run('claude', args, prompt(request)), request.levels)
        } catch (error) {
          failure ??= error
          throw error
        }
      }),
  }
}

/** The levels in claude's answer, or an error saying what went wrong. */
function compression({ code, stdout, stderr }: RunResult, levels: readonly LevelName[]): Compression {
  const envelope = parseJson(stdout)
  if (code !== 0 || !isObject(envelope) || envelope.is_error === true) {
    const said = isObject(envelope) && typeof envelope.result === 'string' ? envelope.result : stderr.trim() || stdout.trim()
    throw new Error(`claude failed: ${said}`)
  }
  const output = envelope.structured_output
  if (!isObject(output) || !levels.every((level) => isLevel(output[level]))) {
    throw new Error(`claude failed: expected the levels, got ${JSON.stringify(output)}`)
  }
  return output as Compression
}

type JsonObject = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const isLevel = (value: unknown): boolean =>
  isObject(value) && typeof value.text === 'string' && Array.isArray(value.sources) && value.sources.every((source) => typeof source === 'string')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Runs tasks no more than `concurrency` at a time, handing each freed slot to the next waiting task. */
function limit(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async (task) => {
    if (active < concurrency) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next === undefined) active--
      else next()
    }
  }
}

/** Runs a process away from this project, so it picks up no project instructions or settings. */
const runProcess: Run = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => reject(new Error(`cannot run ${command}: ${error.message}`)))
    // A process that exits before reading its input breaks the pipe; its exit code says why.
    child.stdin.on('error', () => {})
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(input)
  })
