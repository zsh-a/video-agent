import {expect} from '#test/expect'

import {formatProviderReport} from '../../src/utils/provider-report-output.js'

describe('provider-report command', () => {
  it('formats provider report summaries', () => {
    expect(formatProviderReport({
      calls: [],
      llmTraces: [],
      projectId: 'demo',
      summary: {
        byModel: {
          'mimo-vlm': {
            costs: {USD: 0.02},
            durationMs: 200,
            failed: 1,
            succeeded: 0,
            total: 1,
            usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 8, outputCharacters: 0, outputTokens: 4, totalTokens: 12},
          },
        },
        byProvider: {
          llm: {
            costs: {USD: 0.02},
            durationMs: 200,
            failed: 1,
            succeeded: 0,
            total: 1,
            usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 8, outputCharacters: 0, outputTokens: 4, totalTokens: 12},
          },
        },
        byRole: {
          asr: {costs: {}, durationMs: 0, failed: 0, succeeded: 0, total: 0, usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 0, outputCharacters: 0, outputTokens: 0, totalTokens: 0}},
          script: {costs: {}, durationMs: 0, failed: 0, succeeded: 0, total: 0, usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 0, outputCharacters: 0, outputTokens: 0, totalTokens: 0}},
          tts: {costs: {}, durationMs: 0, failed: 0, succeeded: 0, total: 0, usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 0, outputCharacters: 0, outputTokens: 0, totalTokens: 0}},
          vlm: {
            costs: {USD: 0.02},
            durationMs: 200,
            failed: 1,
            succeeded: 0,
            total: 1,
            usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 8, outputCharacters: 0, outputTokens: 4, totalTokens: 12},
          },
        },
        costs: {USD: 0.02},
        durationMs: {average: 200, max: 200, total: 200},
        failed: 1,
        llm: {
          byModel: {
            'mimo-v2.5': {
              durationMs: 300,
              failed: 0,
              succeeded: 1,
              total: 1,
              usage: {inputTokens: 100, outputTokens: 40, totalTokens: 140},
            },
          },
          byOperation: {
            generateObject: {
              durationMs: 300,
              failed: 0,
              succeeded: 1,
              total: 1,
              usage: {inputTokens: 100, outputTokens: 40, totalTokens: 140},
            },
          },
          byProvider: {
            'mimo.chat': {
              durationMs: 300,
              failed: 0,
              succeeded: 1,
              total: 1,
              usage: {inputTokens: 100, outputTokens: 40, totalTokens: 140},
            },
          },
          durationMs: {average: 300, max: 300, total: 300},
          failed: 0,
          succeeded: 1,
          total: 1,
          usage: {inputTokens: 100, outputTokens: 40, totalTokens: 140},
        },
        succeeded: 0,
        total: 1,
        usage: {audioSeconds: 0, inputCharacters: 0, inputTokens: 8, outputCharacters: 0, outputTokens: 4, totalTokens: 12},
      },
    })).to.equal([
      'Project: demo',
      'Provider calls: 1 (1 failed)',
      'Duration: 200ms total, 200ms avg, 200ms max',
      'Usage: 12 tokens, 8 input tokens, 4 output tokens',
      'Cost: 0.02 USD',
      '',
      'LLM traces: 1 (0 failed)',
      'LLM duration: 300ms total, 300ms avg, 300ms max',
      'LLM usage: 140 tokens, 100 input tokens, 40 output tokens',
      '',
      'By LLM operation:',
      '  generateObject: 1 calls, 0 failed, 300ms, usage 140 tokens, 100 input tokens, 40 output tokens',
      '',
      'By LLM provider:',
      '  mimo.chat: 1 calls, 0 failed, 300ms, usage 140 tokens, 100 input tokens, 40 output tokens',
      '',
      'By LLM model:',
      '  mimo-v2.5: 1 calls, 0 failed, 300ms, usage 140 tokens, 100 input tokens, 40 output tokens',
      '',
      'By role:',
      '  asr: 0 calls, 0 failed, 0ms, usage none, cost none',
      '  script: 0 calls, 0 failed, 0ms, usage none, cost none',
      '  tts: 0 calls, 0 failed, 0ms, usage none, cost none',
      '  vlm: 1 calls, 1 failed, 200ms, usage 12 tokens, 8 input tokens, 4 output tokens, cost 0.02 USD',
      '',
      'By provider:',
      '  llm: 1 calls, 1 failed, 200ms, usage 12 tokens, 8 input tokens, 4 output tokens, cost 0.02 USD',
      '',
      'By model:',
      '  mimo-vlm: 1 calls, 1 failed, 200ms, usage 12 tokens, 8 input tokens, 4 output tokens, cost 0.02 USD',
    ].join('\n'))
  })
})
