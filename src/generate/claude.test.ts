import { describe, expect, it } from 'vitest'
import type { CheckRequest } from './check'
import { claudeChecker, claudeCompressor, type Run, type RunResult } from './claude'
import type { CompressionRequest } from './generate'

const request: CompressionRequest = {
  title: 'Execution Classes',
  heading: 'The scaffolding paradox',
  passage: 'A naive reading is "weaker model, longer prompt". This fails in practice.',
  levels: ['headline', 'summary'],
}

const level = { text: 'Longer prompts fail', sources: ['This fails in practice.'] }

/** The envelope `claude -p --output-format json` prints. */
const envelope = (fields: Readonly<Record<string, unknown>>): RunResult => ({
  code: 0,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...fields }),
  stderr: '',
})

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly input: string
}

function fakeRun(result: RunResult): Run & { readonly calls: Call[] } {
  const calls: Call[] = []
  return Object.assign(
    async (command: string, args: readonly string[], input: string) => {
      calls.push({ command, args, input })
      return result
    },
    { calls },
  )
}

const flag = (args: readonly string[], name: string): string | undefined => args[args.indexOf(name) + 1]

describe('claudeCompressor', () => {
  it('asks claude, with no tools, for the levels requested in the shape of a schema', async () => {
    const run = fakeRun(envelope({ structured_output: { headline: level, summary: level } }))

    await claudeCompressor({ model: 'claude-sonnet-5-5', run }).compress(request)

    const [call] = run.calls
    expect(call?.command).toBe('claude')
    expect(call?.args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']))
    expect(flag(call?.args ?? [], '--setting-sources')).toBe('')
    expect(flag(call?.args ?? [], '--model')).toBe('claude-sonnet-5-5')
    expect(flag(call?.args ?? [], '--output-format')).toBe('json')
    expect(flag(call?.args ?? [], '--tools')).toBe('')
    expect(flag(call?.args ?? [], '--system-prompt')).toMatch(/Compress, do not invent/)
    expect(JSON.parse(flag(call?.args ?? [], '--json-schema') ?? '')).toMatchObject({
      type: 'object',
      required: ['headline', 'summary'],
      properties: { headline: { required: ['text', 'sources'] }, summary: { required: ['text', 'sources'] } },
    })
    expect(call?.input).toBe(`Note: Execution Classes
Section: The scaffolding paradox
Levels: headline, summary

Passage:
${request.passage}
`)
  })

  it('asks only for the levels requested, and leaves out a missing heading', async () => {
    const run = fakeRun(envelope({ structured_output: { headline: level } }))

    await claudeCompressor({ model: 'm', run }).compress({ title: 'T', passage: 'P', levels: ['headline'] })

    const [call] = run.calls
    expect(JSON.parse(flag(call?.args ?? [], '--json-schema') ?? '')).toMatchObject({ required: ['headline'] })
    expect(JSON.parse(flag(call?.args ?? [], '--json-schema') ?? '').properties).not.toHaveProperty('summary')
    expect(call?.input).toBe('Note: T\nLevels: headline\n\nPassage:\nP\n')
  })

  it('reads the levels from the structured output', async () => {
    const run = fakeRun(envelope({ structured_output: { headline: level, summary: { text: 'S', sources: ['A', 'B'] } } }))

    expect(await claudeCompressor({ model: 'm', run }).compress(request)).toEqual({ headline: level, summary: { text: 'S', sources: ['A', 'B'] } })
  })

  it('fails with what claude said when it reports an error or exits with one', async () => {
    const reported = fakeRun(envelope({ is_error: true, subtype: 'error_during_execution', result: 'Credit balance is too low' }))
    const exited = fakeRun({ code: 1, stdout: '', stderr: 'Not logged in\n' })

    await expect(claudeCompressor({ model: 'm', run: reported }).compress(request)).rejects.toThrow('claude failed: Credit balance is too low')
    await expect(claudeCompressor({ model: 'm', run: exited }).compress(request)).rejects.toThrow('claude failed: Not logged in')
  })

  it('fails when the output is not the levels it asked for', async () => {
    const compress = (output: unknown) => claudeCompressor({ model: 'm', run: fakeRun(envelope({ structured_output: output })) }).compress(request)

    await expect(compress(undefined)).rejects.toThrow('claude failed: expected the levels, got undefined')
    await expect(compress({ headline: { text: 'H', sources: 'one' } })).rejects.toThrow(
      'claude failed: expected the levels, got {"headline":{"text":"H","sources":"one"}}',
    )
  })

  it('fails the calls still waiting once one fails, without running them', async () => {
    const run = fakeRun({ code: 1, stdout: '', stderr: 'Rate limited' })
    const compressor = claudeCompressor({ model: 'm', run, concurrency: 1 })

    const results = await Promise.allSettled([compressor.compress(request), compressor.compress(request)])

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(run.calls).toHaveLength(1)
  })

  it('refuses a concurrency that is not a positive whole number', () => {
    for (const concurrency of [0, -1, 1.5, Number.NaN]) {
      expect(() => claudeCompressor({ model: 'm', concurrency })).toThrow(`concurrency must be a positive whole number, not ${concurrency}`)
    }
  })

  it('runs no more than the given number of calls at once', async () => {
    let running = 0
    let most = 0
    const run: Run = async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return envelope({ structured_output: { headline: level, summary: level } })
    }
    const compressor = claudeCompressor({ model: 'm', run, concurrency: 2 })

    await Promise.all(Array.from({ length: 5 }, () => compressor.compress(request)))

    expect(most).toBe(2)
  })
})

describe('claudeChecker', () => {
  const asked: CheckRequest = {
    passage: request.passage,
    levels: [
      { id: 'p1', text: 'Longer prompts fail' },
      { id: 'p1-summary', text: 'Longer prompts fail small models.' },
    ],
  }
  const judged = {
    levels: [
      { id: 'p1', claims: [{ claim: 'Longer prompts fail', verdict: 'supported', evidence: ['This fails in practice.'] }] },
      { id: 'p1-summary', claims: [{ claim: 'Only small models', verdict: 'unsupported', evidence: [] }] },
    ],
  }

  it('asks claude, with no tools, to judge the claims of the levels it names against the passage, in the shape of a schema', async () => {
    const run = fakeRun(envelope({ structured_output: judged }))

    await claudeChecker({ model: 'claude-opus-5-5', run }).check(asked)

    const [call] = run.calls
    expect(call?.command).toBe('claude')
    expect(call?.args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']))
    expect(flag(call?.args ?? [], '--model')).toBe('claude-opus-5-5')
    expect(flag(call?.args ?? [], '--tools')).toBe('')
    expect(flag(call?.args ?? [], '--setting-sources')).toBe('')
    expect(flag(call?.args ?? [], '--system-prompt')).toMatch(/judge each against the passage alone/)
    expect(JSON.parse(flag(call?.args ?? [], '--json-schema') ?? '')).toMatchObject({
      required: ['levels'],
      properties: {
        levels: {
          items: {
            required: ['id', 'claims'],
            properties: {
              id: { enum: ['p1', 'p1-summary'] },
              claims: { minItems: 1, items: { properties: { verdict: { enum: ['supported', 'overstated', 'unsupported', 'contradicted'] } } } },
            },
          },
        },
      },
    })
    expect(call?.input).toBe(`Passage:
${request.passage}

Levels:
p1: Longer prompts fail
p1-summary: Longer prompts fail small models.
`)
  })

  it('reads the judgements from the structured output', async () => {
    expect(await claudeChecker({ model: 'm', run: fakeRun(envelope({ structured_output: judged })) }).check(asked)).toEqual(judged)
  })

  it('fails when the output is not judgements', async () => {
    const check = (output: unknown) => claudeChecker({ model: 'm', run: fakeRun(envelope({ structured_output: output })) }).check(asked)
    const claim = { claim: 'A claim', verdict: 'supported', evidence: ['This fails in practice.'] }

    for (const output of [
      undefined,
      { levels: 'p1' },
      { levels: [{ id: 1, claims: [claim] }] },
      { levels: [{ id: 'p1', claims: [{ ...claim, verdict: 'plausible' }] }] },
      { levels: [{ id: 'p1', claims: [{ ...claim, evidence: 'This fails' }] }] },
      { levels: [{ id: 'p1', claims: [{ ...claim, claim: undefined }] }] },
    ]) {
      await expect(check(output)).rejects.toThrow(`claude failed: expected the judgements, got ${JSON.stringify(output)}`)
    }
  })

  it('fails with what claude said, and fails the calls still waiting once one fails', async () => {
    const run = fakeRun({ code: 1, stdout: '', stderr: 'Rate limited' })
    const checker = claudeChecker({ model: 'm', run, concurrency: 1 })

    const results = await Promise.allSettled([checker.check(asked), checker.check(asked)])

    expect(results).toEqual([
      { status: 'rejected', reason: new Error('claude failed: Rate limited') },
      { status: 'rejected', reason: new Error('claude failed: Rate limited') },
    ])
    expect(run.calls).toHaveLength(1)
  })
})
