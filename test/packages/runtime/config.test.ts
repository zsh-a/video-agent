import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readConfig, writeConfig} from '../../../packages/runtime/src/config.js'

describe('config', () => {
  it('returns mock defaults before a config file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const config = await readConfig(root)

      expect(config.providers).to.deep.equal({
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      })
      expect(config.persistence.jobStore).to.equal('json')
      expect(config.pipeline).to.deep.equal({
        maxStageRetries: 0,
        retryBackoffMs: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config, path} = await writeConfig(root, {asr: 'mock'})

      expect(path).to.contain('config.json')
      expect(config.providers.asr).to.equal('mock')
      expect((await readConfig(root)).providers.asr).to.equal('mock')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('normalizes older config files without persistence settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeFile(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'command',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const config = await readConfig(root)

      expect(config.persistence.jobStore).to.equal('json')
      expect(config.providers.asr).to.equal('command')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes job store configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {jobStore: 'sqlite'})

      expect(config.persistence.jobStore).to.equal('sqlite')
      expect((await readConfig(root)).persistence.jobStore).to.equal('sqlite')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes pipeline retry configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        maxStageRetries: 2,
        retryBackoffMs: 10,
      })

      expect(config.pipeline).to.deep.equal({
        maxStageRetries: 2,
        retryBackoffMs: 10,
      })
      expect((await readConfig(root)).pipeline.maxStageRetries).to.equal(2)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes command provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })

      expect(config.providers).to.deep.equal({
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes http provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        asr: 'http',
        tts: 'http',
        vlm: 'http',
      })

      expect(config.providers).to.deep.equal({
        asr: 'http',
        tts: 'http',
        vlm: 'http',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
