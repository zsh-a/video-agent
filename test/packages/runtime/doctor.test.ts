import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../packages/runtime/src/shared/config.js'
import {checkRuntimeHealth} from '../../../packages/runtime/src/doctor/index.js'

describe('doctor', () => {
  it('reports required runtime checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.summary.fail).to.equal(0)
      expect(report.summary.total).to.equal(10)
      expect(report.summary.pass + report.summary.warn).to.equal(10)
      expect(report.workspaceDir).to.equal(root)
      expect(report.checks.map((check) => check.name)).to.deep.equal([
        'bun',
        'workspace',
        'config',
        'provider:asr',
        'provider:vlm',
        'provider:tts',
        'projects',
        'ffmpeg',
        'ffprobe',
        'chromium',
      ])
      expect(report.checks.find((check) => check.name === 'workspace')?.status).to.equal('pass')
      expect(report.checks.find((check) => check.name === 'ffmpeg')?.status).to.equal('pass')
      expect(report.checks.find((check) => check.name === 'provider:asr')?.status).to.equal('pass')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails when required media binaries are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'video-agent-missing-ffmpeg',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.summary.fail).to.equal(1)
      expect(report.checks.find((check) => check.name === 'ffmpeg')?.status).to.equal('fail')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails when command providers are missing command env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.summary.fail).to.equal(1)
      expect(report.checks.find((check) => check.name === 'provider:asr')?.status).to.equal('fail')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes command provider checks with explicit env values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        env: {
          VIDEO_AGENT_ASR_COMMAND: '["bun","examples/provider-adapters/mock-json-provider.ts"]',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.checks.find((check) => check.name === 'provider:asr')?.status).to.equal('pass')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails when llm providers are missing llm config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {asr: 'llm'})

      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.checks.find((check) => check.name === 'provider:asr')?.message).to.contain('llm is not configured')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('checks shared llm auth env for llm providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {providerProfile: 'mimo'})

      const missing = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        env: {},
        workspaceDir: root,
      })

      expect(missing.ok).to.equal(false)
      expect(missing.checks.find((check) => check.name === 'provider:asr')?.message).to.contain('VIDEO_AGENT_LLM_TOKEN')
      expect(missing.checks.find((check) => check.name === 'provider:asr')?.message).to.contain('MIMO_API_KEY')

      const configured = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        env: {
          MIMO_API_KEY: 'secret',
        },
        workspaceDir: root,
      })

      expect(configured.ok).to.equal(true)
      expect(configured.checks.find((check) => check.name === 'provider:asr')?.status).to.equal('pass')
      expect(configured.checks.find((check) => check.name === 'provider:vlm')?.status).to.equal('pass')
      expect(configured.checks.find((check) => check.name === 'provider:tts')?.status).to.equal('pass')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reads shared llm auth from workspace .env by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {providerProfile: 'mimo'})
      await writeText(join(root, '.env'), 'VIDEO_AGENT_LLM_TOKEN=dotenv-token\n')

      const report = await checkRuntimeHealth({
        binaries: {
          chromium: 'true',
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.checks.find((check) => check.name === 'provider:asr')?.status).to.equal('pass')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
