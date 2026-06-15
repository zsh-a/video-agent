import {expect as bunExpect} from 'bun:test'

type AssertionTarget = unknown

interface AssertionChain {
  a(type: string): void
  an(type: string): void
  be: AssertionChain
  contain(expected: unknown): void
  deep: Pick<AssertionChain, 'equal' | 'include'>
  equal(expected: unknown): void
  greaterThan(expected: number): void
  have: Pick<AssertionChain, 'keys' | 'length' | 'property'>
  include: ((expected: unknown) => void) & {members(expected: unknown[]): void}
  instanceOf(expected: new (...args: never[]) => unknown): void
  keys(expected: string[]): void
  length(expected: number): void
  lessThan(expected: number): void
  match(expected: RegExp): void
  not: Pick<AssertionChain, 'include'>
  property(expected: string): void
  throw(expected?: RegExp | string): void
  to: AssertionChain
}

export function expect(actual: AssertionTarget): AssertionChain {
  return createChain(actual, false)
}

function createChain(actual: AssertionTarget, negate: boolean): AssertionChain {
  const chain = {
    a: (type: string) => assertType(actual, type, negate),
    an: (type: string) => assertType(actual, type, negate),
    contain: (expected: unknown) => assertIncludes(actual, expected, negate, false),
    deep: {
      equal: (expected: unknown) => assertEqual(actual, expected, negate, true),
      include: (expected: unknown) => assertIncludes(actual, expected, negate, true),
    },
    equal: (expected: unknown) => assertEqual(actual, expected, negate, false),
    greaterThan: (expected: number) => assertNumber(actual, expected, negate, 'greaterThan'),
    have: {
      keys: (expected: string[]) => assertKeys(actual, expected, negate),
      length: (expected: number) => assertLength(actual, expected, negate),
      property: (expected: string) => assertProperty(actual, expected, negate),
    },
    include: Object.assign((expected: unknown) => assertIncludes(actual, expected, negate, false), {
      members: (expected: unknown[]) => assertMembers(actual, expected, negate),
    }),
    instanceOf: (expected: new (...args: never[]) => unknown) => assertInstanceOf(actual, expected, negate),
    keys: (expected: string[]) => assertKeys(actual, expected, negate),
    length: (expected: number) => assertLength(actual, expected, negate),
    lessThan: (expected: number) => assertNumber(actual, expected, negate, 'lessThan'),
    match: (expected: RegExp) => assertMatch(actual, expected, negate),
    not: {
      include: (expected: unknown) => assertIncludes(actual, expected, !negate, false),
    },
    property: (expected: string) => assertProperty(actual, expected, negate),
    throw: (expected?: RegExp | string) => assertThrows(actual, expected, negate),
  } as AssertionChain

  chain.be = chain
  chain.to = chain

  return chain
}

function assertEqual(actual: AssertionTarget, expected: unknown, negate: boolean, deep: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  if (deep) {
    matcher.toEqual(expected)
    return
  }

  matcher.toBe(expected)
}

function assertIncludes(actual: AssertionTarget, expected: unknown, negate: boolean, deep: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  if (typeof actual === 'string') {
    matcher.toContain(String(expected))
    return
  }

  if (Array.isArray(actual)) {
    if (deep) {
      matcher.toContainEqual(expected)
      return
    }

    matcher.toContain(expected)
    return
  }

  if (isRecord(actual) && isRecord(expected)) {
    matcher.toMatchObject(expected)
    return
  }

  matcher.toContain(expected)
}

function assertMembers(actual: AssertionTarget, expected: unknown[], negate: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  matcher.toEqual(bunExpect.arrayContaining(expected))
}

function assertKeys(actual: AssertionTarget, expected: string[], negate: boolean): void {
  const keys = Object.keys(assertRecord(actual)).sort()
  const matcher = negate ? bunExpect(keys).not : bunExpect(keys)

  matcher.toEqual([...expected].sort())
}

function assertLength(actual: AssertionTarget, expected: number, negate: boolean): void {
  const matcher = negate ? bunExpect(assertHasLength(actual).length).not : bunExpect(assertHasLength(actual).length)

  matcher.toBe(expected)
}

function assertProperty(actual: AssertionTarget, expected: string, negate: boolean): void {
  const matcher = negate ? bunExpect(assertRecord(actual)).not : bunExpect(assertRecord(actual))

  matcher.toHaveProperty(expected)
}

function assertInstanceOf(actual: AssertionTarget, expected: new (...args: never[]) => unknown, negate: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  matcher.toBeInstanceOf(expected)
}

function assertNumber(actual: AssertionTarget, expected: number, negate: boolean, comparison: 'greaterThan' | 'lessThan'): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  if (comparison === 'greaterThan') {
    matcher.toBeGreaterThan(expected)
    return
  }

  matcher.toBeLessThan(expected)
}

function assertMatch(actual: AssertionTarget, expected: RegExp, negate: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  matcher.toMatch(expected)
}

function assertType(actual: AssertionTarget, expected: string, negate: boolean): void {
  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  if (expected === 'array') {
    matcher.toBeArray()
    return
  }

  matcher.toBeTypeOf(expected)
}

function assertThrows(actual: AssertionTarget, expected: RegExp | string | undefined, negate: boolean): void {
  if (typeof actual !== 'function') {
    throw new TypeError('Expected throw assertion target to be a function.')
  }

  const matcher = negate ? bunExpect(actual).not : bunExpect(actual)

  matcher.toThrow(expected)
}

function assertRecord(value: AssertionTarget): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError('Expected assertion target to be an object.')
  }

  return value
}

function assertHasLength(value: AssertionTarget): {length: number} {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || typeof value !== 'object' || !('length' in value)) {
    throw new TypeError('Expected assertion target to have a length property.')
  }

  return value as {length: number}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
