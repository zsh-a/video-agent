import {expect} from '#test/expect'

import {
  readOptionalBooleanInput,
  readOptionalEnumInput,
  readOptionalNonNegativeIntegerInput,
  readOptionalPositiveIntegerInput,
  readOptionalStringArrayInput,
  readOptionalStringInput,
  readOptionalStringRecordInput,
} from '../../../packages/runtime/src/shared/input.js'

class TestInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestInputError'
  }
}

const reader = {
  createError: (message: string) => new TestInputError(message),
  label: 'Test field',
}

describe('shared input readers', () => {
  it('treats missing and null fields as optional', () => {
    expect(readOptionalStringInput({}, 'name', reader)).to.equal(undefined)
    expect(readOptionalBooleanInput({enabled: null}, 'enabled', reader)).to.equal(undefined)
  })

  it('uses caller-specific labels and error types for invalid fields', () => {
    expect(() => readOptionalStringInput({name: 1}, 'name', reader)).to.throw(TestInputError, 'Test field name must be a string.')
  })

  it('reads positive and non-negative integers through explicit boundaries', () => {
    expect(readOptionalNonNegativeIntegerInput({limit: 0}, 'limit', reader)).to.equal(0)
    expect(readOptionalPositiveIntegerInput({fps: 1}, 'fps', reader)).to.equal(1)
    expect(() => readOptionalNonNegativeIntegerInput({limit: -1}, 'limit', reader)).to.throw(TestInputError, 'Test field limit must be a non-negative integer.')
    expect(() => readOptionalPositiveIntegerInput({fps: 0}, 'fps', reader)).to.throw(TestInputError, 'Test field fps must be a positive integer.')
  })

  it('supports adapter-specific string array strictness', () => {
    expect(readOptionalStringArrayInput({command: []}, 'command', reader)).to.deep.equal([])
    expect(() => readOptionalStringArrayInput({command: []}, 'command', {
      ...reader,
      allowEmpty: false,
      allowEmptyItems: false,
      description: 'a non-empty string array',
    })).to.throw(TestInputError, 'Test field command must be a non-empty string array.')
    expect(() => readOptionalStringArrayInput({command: ['']}, 'command', {
      ...reader,
      allowEmpty: false,
      allowEmptyItems: false,
      description: 'a non-empty string array',
    })).to.throw(TestInputError, 'Test field command must be a non-empty string array.')
  })

  it('reads string records and enums through one boundary', () => {
    expect(readOptionalStringRecordInput({env: {TOKEN: 'secret'}}, 'env', reader)).to.deep.equal({TOKEN: 'secret'})
    expect(readOptionalEnumInput({mode: 'fast'}, 'mode', ['fast', 'slow'], reader)).to.equal('fast')
    expect(() => readOptionalStringRecordInput({env: {TOKEN: 1}}, 'env', reader)).to.throw(TestInputError, 'Test field env.TOKEN must be a string.')
    expect(() => readOptionalEnumInput({mode: 'medium'}, 'mode', ['fast', 'slow'], reader)).to.throw(TestInputError, 'Test field mode must be one of: fast, slow.')
  })
})
