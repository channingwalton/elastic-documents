import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { verdicts, type CheckRequest, type CheckResponse, type Checker } from './check.ts'
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

const compressing = `You write the shorter levels of an elastic document, which a reader opens from a headline down to the author's own words.

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

const compressionSchema = (levels: readonly LevelName[]) => ({
  type: 'object',
  properties: Object.fromEntries(levels.map((level) => [level, levelSchema])),
  required: levels,
  additionalProperties: false,
})

const compressionPrompt = ({ title, heading, passage, levels }: CompressionRequest): string =>
  [`Note: ${title}`, ...(heading === undefined ? [] : [`Section: ${heading}`]), `Levels: ${levels.join(', ')}`, '', 'Passage:', passage, ''].join('\n')

/** Writes the shorter levels of a passage with `claude -p`. */
export function claudeCompressor(options: ClaudeOptions): Compressor {
  const ask = claude(options)
  return {
    compress: (request) =>
      ask({
        instructions: compressing,
        schema: compressionSchema(request.levels),
        input: compressionPrompt(request),
        read: (output) => (isObject(output) && request.levels.every((level) => isLevel(output[level])) ? (output as Compression) : undefined),
        expected: 'the levels',
      }),
  }
}

const checking = `You check the shorter levels of an elastic document, which compress an author's passage, for claims the passage does not make.

For each level, list every claim it makes, and judge each against the passage alone, not against what you know:
- supported: the passage says it, at least as strongly.
- overstated: the passage says something weaker, and the level drops a hedge, condition or limit, or makes the claim more certain or more general.
- unsupported: the passage does not say it.
- contradicted: the passage says the opposite.

For each claim, give as evidence the parts of the passage that show your verdict. Copy each one exactly, character for character, as one unbroken run of the passage's text at least three words long. Do not change its punctuation, spelling, capitals or spacing, and do not join separate parts with an ellipsis. Where the passage shows " […] ", text was left out, and no evidence may include it. For an unsupported claim, quote the nearest the passage comes, or nothing if nothing comes near.

Judge every level you are given, once each, by its id.`

const checkSchema = (ids: readonly string[]) => ({
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ids },
          claims: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                verdict: { type: 'string', enum: verdicts },
                evidence: { type: 'array', items: { type: 'string' } },
              },
              required: ['claim', 'verdict', 'evidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'claims'],
        additionalProperties: false,
      },
    },
  },
  required: ['levels'],
  additionalProperties: false,
})

const checkPrompt = ({ passage, levels }: CheckRequest): string =>
  ['Passage:', passage, '', 'Levels:', ...levels.map(({ id, text }) => `${id}: ${text}`), ''].join('\n')

/** Judges the claims of a passage's shorter levels with `claude -p`. */
export function claudeChecker(options: ClaudeOptions): Checker {
  const ask = claude(options)
  return {
    check: (request) =>
      ask({
        instructions: checking,
        schema: checkSchema(request.levels.map((level) => level.id)),
        input: checkPrompt(request),
        read: (output) => (isCheckResponse(output) ? output : undefined),
        expected: 'the judgements',
      }),
  }
}

/** What claude is told, the shape it answers in, what it is given, and how its answer is read. */
interface Question<T> {
  readonly instructions: string
  readonly schema: object
  readonly input: string
  /** The answer, or `undefined` if the output is not what was asked for. */
  readonly read: (output: unknown) => T | undefined
  /** What was asked for, to say so when the output is not it. */
  readonly expected: string
}

/**
 * The model behind `claude -p`: Claude Code run headless, answering in a
 * schema, with no tools and none of the user's settings or instructions, so
 * nothing but the question shapes the answer. Once a call fails the whole run
 * fails, so the calls still waiting fail at once rather than run.
 */
function claude({ model, concurrency = 4, run = runProcess }: ClaudeOptions): <T>(question: Question<T>) => Promise<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive whole number, not ${concurrency}`)
  }
  const limited = limit(concurrency)
  let failure: unknown
  return (question) =>
    limited(async () => {
      if (failure !== undefined) throw failure
      const args = [
        '-p',
        '--model',
        model,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(question.schema),
        '--system-prompt',
        question.instructions,
        '--tools',
        '',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
      ]
      try {
        return answer(await run('claude', args, question.input), question)
      } catch (error) {
        failure ??= error
        throw error
      }
    })
}

/** Claude's answer, or an error saying what went wrong. */
function answer<T>({ code, stdout, stderr }: RunResult, { read, expected }: Question<T>): T {
  const envelope = parseJson(stdout)
  if (code !== 0 || !isObject(envelope) || envelope.is_error === true) {
    const said = isObject(envelope) && typeof envelope.result === 'string' ? envelope.result : stderr.trim() || stdout.trim()
    throw new Error(`claude failed: ${said}`)
  }
  const output = read(envelope.structured_output)
  if (output === undefined) throw new Error(`claude failed: expected ${expected}, got ${JSON.stringify(envelope.structured_output)}`)
  return output
}

type JsonObject = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === 'string')

const isLevel = (value: unknown): boolean => isObject(value) && typeof value.text === 'string' && isStrings(value.sources)

const isJudgement = (value: unknown): boolean =>
  isObject(value) && typeof value.claim === 'string' && (verdicts as readonly unknown[]).includes(value.verdict) && isStrings(value.evidence)

const isCheckResponse = (value: unknown): value is CheckResponse =>
  isObject(value) &&
  Array.isArray(value.levels) &&
  value.levels.every((level) => isObject(level) && typeof level.id === 'string' && Array.isArray(level.claims) && level.claims.every(isJudgement))

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
