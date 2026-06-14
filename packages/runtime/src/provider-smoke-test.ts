import {createAsrProvider, createTtsProvider, createVlmProvider, type ProviderFetch, ProviderResponseValidationError, readProviderMetadata} from '@video-agent/providers'

import {readConfig} from './config.js'

export type ProviderSmokeTestRole = 'asr' | 'tts' | 'vlm'
export type ProviderSmokeTestStatus = 'failed' | 'succeeded'

export interface ProviderSmokeTestOptions {
  env?: Record<string, string | undefined>
  fetch?: ProviderFetch
  framePath?: string
  mediaPath?: string
  roles?: ProviderSmokeTestRole[]
  text?: string
  workspaceDir?: string
}

export interface ProviderSmokeTestReport {
  ok: boolean
  results: ProviderSmokeTestResult[]
  workspaceDir: string
}

export interface ProviderSmokeTestResult {
  durationMs: number
  error?: {
    message: string
    name: string
    validationIssues?: {
      code: string
      message: string
      path: string[]
    }[]
  }
  metadata?: {
    model?: string
    requestId?: string
  }
  output?: ProviderSmokeTestOutput
  provider: string
  role: ProviderSmokeTestRole
  status: ProviderSmokeTestStatus
}

export type ProviderSmokeTestOutput =
  | {
      characters: number
      language?: string
      segments: number
      type: 'transcript'
    }
  | {
      duration: number
      paths: string[]
      segments: number
      type: 'tts'
    }
  | {
      evidence: number
      scenes: number
      type: 'scenes'
    }

const DEFAULT_ROLES: ProviderSmokeTestRole[] = ['asr', 'vlm', 'tts']

export async function runProviderSmokeTest(options: ProviderSmokeTestOptions = {}): Promise<ProviderSmokeTestReport> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const config = await readConfig(workspaceDir)
  const roles = options.roles ?? DEFAULT_ROLES
  const results: ProviderSmokeTestResult[] = []

  /* eslint-disable no-await-in-loop */
  for (const role of roles) {
    const startedAt = Date.now()

    try {
      const output = await runRoleSmokeTest(role, config.providers[role], options)
      const metadata = readSmokeTestMetadata(output.raw)

      results.push({
        durationMs: Date.now() - startedAt,
        ...(metadata === undefined ? {} : {metadata}),
        output: output.summary,
        provider: config.providers[role],
        role,
        status: 'succeeded',
      })
    } catch (error) {
      results.push({
        durationMs: Date.now() - startedAt,
        error: normalizeSmokeTestError(error),
        provider: config.providers[role],
        role,
        status: 'failed',
      })
    }
  }
  /* eslint-enable no-await-in-loop */

  return {
    ok: results.every((result) => result.status === 'succeeded'),
    results,
    workspaceDir,
  }
}

function normalizeSmokeTestError(error: unknown): NonNullable<ProviderSmokeTestResult['error']> {
  if (error instanceof ProviderResponseValidationError) {
    return {
      message: error.message,
      name: error.name,
      validationIssues: error.issues,
    }
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
  }
}

async function runRoleSmokeTest(role: ProviderSmokeTestRole, provider: string, options: ProviderSmokeTestOptions): Promise<{raw: object; summary: ProviderSmokeTestOutput}> {
  if (role === 'asr') {
    const transcript = await createAsrProvider(provider, {env: options.env, fetch: options.fetch}).transcribe({
      mimeType: 'audio/wav',
      path: options.mediaPath ?? 'provider-smoke-test.wav',
    })

    return {
      raw: transcript,
      summary: {
        characters: transcript.text.length,
        ...(transcript.language === undefined ? {} : {language: transcript.language}),
        segments: transcript.segments.length,
        type: 'transcript',
      },
    }
  }

  if (role === 'tts') {
    const segments = await createTtsProvider(provider, {env: options.env, fetch: options.fetch}).synthesize([
      {
        duration: 1,
        id: 'provider-smoke-test',
        start: 0,
        text: options.text ?? 'Provider smoke test narration.',
      },
    ])

    return {
      raw: segments,
      summary: {
        duration: segments.reduce((total, segment) => total + segment.duration, 0),
        paths: segments.map((segment) => segment.path),
        segments: segments.length,
        type: 'tts',
      },
    }
  }

  const scenes = await createVlmProvider(provider, {env: options.env, fetch: options.fetch}).analyzeScenes([
    {
      frames: [options.framePath ?? 'provider-smoke-test-frame.jpg'],
      sceneId: 'provider-smoke-test-scene',
      timeRange: [0, 1],
    },
  ], 'Provider smoke test visual context.')

  return {
    raw: scenes,
    summary: {
      evidence: scenes.reduce((total, scene) => total + scene.evidence.length, 0),
      scenes: scenes.length,
      type: 'scenes',
    },
  }
}

function readSmokeTestMetadata(value: object): ProviderSmokeTestResult['metadata'] {
  const metadata = readProviderMetadata(value)

  if (metadata === undefined) {
    return undefined
  }

  return {
    ...(metadata.model === undefined ? {} : {model: metadata.model}),
    ...(metadata.requestId === undefined ? {} : {requestId: metadata.requestId}),
  }
}
