import {expect} from '#test/expect'

import type {PipelineEvent, Stage} from '../../../packages/core/src/index.js'

import {runPipeline} from '../../../packages/core/src/index.js'

describe('pipeline', () => {
  it('retries a failed stage before completing', async () => {
    const events: PipelineEvent[] = []
    let runs = 0
    const stage: Stage<number, number> = {
      name: 'flaky',
      async run(input) {
        runs += 1

        if (runs === 1) {
          throw new Error('temporary failure')
        }

        return input + 1
      },
    }

    const output = await runPipeline<number, number>(1, [stage], {
      artifactsDir: '/tmp/artifacts',
      emit(event) {
        events.push(event)
      },
      projectId: 'demo',
      retryPolicy: {
        maxRetries: 1,
      },
      workspaceDir: '/tmp/workspace',
    })

    expect(output).to.equal(2)
    expect(runs).to.equal(2)
    expect(events.map((event) => event.type)).to.deep.equal(['stage:start', 'stage:fail', 'stage:retry', 'stage:start', 'stage:complete'])
    expect(events.map((event) => event.attempt)).to.deep.equal([1, 1, 1, 2, 2])
  })

  it('throws after retry attempts are exhausted', async () => {
    const events: PipelineEvent[] = []
    const stage: Stage<number, number> = {
      name: 'always-fails',
      async run() {
        throw new Error('permanent failure')
      },
    }
    let error: unknown

    try {
      await runPipeline<number, number>(1, [stage], {
        artifactsDir: '/tmp/artifacts',
        emit(event) {
          events.push(event)
        },
        projectId: 'demo',
        retryPolicy: {
          maxRetries: 1,
        },
        workspaceDir: '/tmp/workspace',
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(events.map((event) => event.type)).to.deep.equal(['stage:start', 'stage:fail', 'stage:retry', 'stage:start', 'stage:fail'])
    expect(events.map((event) => event.attempt)).to.deep.equal([1, 1, 1, 2, 2])
  })

  it('rejects invalid retry policy values instead of clamping them to zero', async () => {
    const events: PipelineEvent[] = []
    let runs = 0
    const stage: Stage<number, number> = {
      name: 'should-not-run',
      async run(input) {
        runs += 1
        return input
      },
    }
    const error = await captureAsyncError(() => runPipeline<number, number>(1, [stage], {
      artifactsDir: '/tmp/artifacts',
      emit(event) {
        events.push(event)
      },
      projectId: 'demo',
      retryPolicy: {
        maxRetries: -1,
      },
      workspaceDir: '/tmp/workspace',
    }))

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('no retry policy clamp fallback is allowed')
    expect(runs).to.equal(0)
    expect(events).to.deep.equal([])
  })
})

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }

  throw new Error('Expected function to throw.')
}
