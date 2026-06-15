import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../packages/runtime/src/config.js'
import {checkRuntimeHealth} from '../../../packages/runtime/src/doctor.js'

describe('doctor', () => {
  it('reports required runtime checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      const report = await checkRuntimeHealth({
        binaries: {
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.summary).to.deep.equal({
        fail: 0,
        pass: 8,
        total: 9,
        warn: 1,
      })
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

  it('fails when http providers are missing URL env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-doctor-'))

    try {
      await writeConfig(root, {asr: 'http'})

      const report = await checkRuntimeHealth({
        binaries: {
          ffmpeg: 'true',
          ffprobe: 'true',
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.checks.find((check) => check.name === 'provider:asr')?.message).to.contain('VIDEO_AGENT_ASR_URL')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
