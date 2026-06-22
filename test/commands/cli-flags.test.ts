import {expect} from '#test/expect'

import {normalizeNonNegativeIntegerFlag, normalizePositiveIntegerFlag, normalizeRequiredNonNegativeIntegerFlag, normalizeRequiredPositiveIntegerFlag, parseCommandPrefixFlag, parseDurationSeconds, parseOptionalEnumFlag, parseOptionalNumberFlag, parseRequiredEnumFlag} from '../../src/utils/cli-flags.js'

describe('cli flag utilities', () => {
  it('parses command prefix flags as binaries or explicit argv JSON', () => {
    expect(parseCommandPrefixFlag('chromium', '--chromium-command')).to.deep.equal(['chromium'])
    expect(parseCommandPrefixFlag('["bun","render.ts","--name=hello world"]', '--renderer-command'))
      .to.deep.equal(['bun', 'render.ts', '--name=hello world'])
  })

  it('rejects malformed command prefix JSON with flag context', () => {
    expect(() => parseCommandPrefixFlag('["bun", ""]', '--renderer-command'))
      .to.throw('--renderer-command JSON value must be a non-empty array of non-empty strings.')
    expect(() => parseCommandPrefixFlag('["bun"', '--renderer-command'))
      .to.throw('--renderer-command JSON value must be a valid array of command arguments')
  })

  it('normalizes CLI integer flags without command-local copies', () => {
    expect(normalizePositiveIntegerFlag(1, '--frame-concurrency')).to.equal(1)
    expect(normalizePositiveIntegerFlag(undefined, '--frame-concurrency')).to.equal(undefined)
    expect(() => normalizePositiveIntegerFlag(0, '--frame-concurrency')).to.throw('--frame-concurrency must be a positive integer.')
    expect(normalizeNonNegativeIntegerFlag(0, '--shard-retries')).to.equal(0)
    expect(() => normalizeNonNegativeIntegerFlag(-1, '--shard-retries')).to.throw('--shard-retries must be a non-negative integer.')
    expect(normalizeRequiredPositiveIntegerFlag(2, '--refresh-ms')).to.equal(2)
    expect(() => normalizeRequiredPositiveIntegerFlag(undefined, '--refresh-ms')).to.throw('--refresh-ms is required.')
    expect(normalizeRequiredNonNegativeIntegerFlag(0, '--event-limit')).to.equal(0)
    expect(() => normalizeRequiredNonNegativeIntegerFlag(undefined, '--event-limit')).to.throw('--event-limit is required.')
  })

  it('parses enum flags without command-local casts', () => {
    const values = ['video', 'bundle'] as const

    expect(parseOptionalEnumFlag('video', values, '--format')).to.equal('video')
    expect(parseOptionalEnumFlag(undefined, values, '--format')).to.equal(undefined)
    expect(parseRequiredEnumFlag('bundle', values, '--format')).to.equal('bundle')
    expect(() => parseRequiredEnumFlag(undefined, values, '--format')).to.throw('--format is required.')
    expect(() => parseOptionalEnumFlag('archive', values, '--format')).to.throw('--format must be one of: video, bundle.')
  })

  it('parses numeric flags without command-local copies', () => {
    expect(parseOptionalNumberFlag('0.75', '--source-volume')).to.equal(0.75)
    expect(parseOptionalNumberFlag(undefined, '--source-volume')).to.equal(undefined)
    expect(() => parseOptionalNumberFlag('loud', '--source-volume')).to.throw('--source-volume must be a finite number.')
  })

  it('parses shared duration flags for Film and Deck commands', () => {
    expect(parseDurationSeconds('500ms')).to.equal(0.5)
    expect(parseDurationSeconds('2m')).to.equal(120)
    expect(parseDurationSeconds('01:02:03')).to.equal(3723)
    expect(() => parseDurationSeconds('0s')).to.throw('Invalid duration: 0s')
  })
})
