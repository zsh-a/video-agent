export interface ProviderCostMetadata {
  amount: number
  currency: string
  estimated?: boolean
}

export interface ProviderUsageMetadata {
  audioSeconds?: number
  inputCharacters?: number
  inputTokens?: number
  outputCharacters?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ProviderResponseMetadata {
  cost?: ProviderCostMetadata
  model?: string
  requestId?: string
  usage?: ProviderUsageMetadata
}

const providerMetadata = new WeakMap<object, ProviderResponseMetadata>()

export function attachProviderMetadata<T extends object>(value: T, metadata: ProviderResponseMetadata | undefined): T {
  if (metadata !== undefined) {
    providerMetadata.set(value, metadata)
  }

  return value
}

export function readProviderMetadata(value: unknown): ProviderResponseMetadata | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  return providerMetadata.get(value)
}

export function parseProviderResponseMetadata(value: unknown): ProviderResponseMetadata | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new TypeError('Provider metadata must be an object.')
  }

  return {
    ...(value.cost === undefined ? {} : {cost: parseCostMetadata(value.cost)}),
    ...parseOptionalMetadataString(value, 'model'),
    ...parseOptionalMetadataString(value, 'requestId'),
    ...(value.usage === undefined ? {} : {usage: parseUsageMetadata(value.usage)}),
  }
}

function parseCostMetadata(value: unknown): ProviderCostMetadata {
  if (!isRecord(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || typeof value.currency !== 'string' || value.currency.trim() === '' || value.currency.trim() !== value.currency) {
    throw new TypeError('Provider cost metadata must include non-negative numeric amount and clean non-empty string currency.')
  }

  return {
    amount: value.amount,
    currency: value.currency,
    ...(typeof value.estimated === 'boolean' ? {estimated: value.estimated} : {}),
  }
}

function parseUsageMetadata(value: unknown): ProviderUsageMetadata {
  if (!isRecord(value)) {
    throw new TypeError('Provider usage metadata must be an object.')
  }

  return {
    ...readOptionalNumber(value, 'audioSeconds'),
    ...readOptionalNumber(value, 'inputCharacters'),
    ...readOptionalNumber(value, 'inputTokens'),
    ...readOptionalNumber(value, 'outputCharacters'),
    ...readOptionalNumber(value, 'outputTokens'),
    ...readOptionalNumber(value, 'totalTokens'),
  }
}

function readOptionalNumber(value: Record<string, unknown>, field: keyof ProviderUsageMetadata): Partial<ProviderUsageMetadata> {
  const item = value[field]

  if (item === undefined) {
    return {}
  }

  if (typeof item !== 'number' || !Number.isFinite(item)) {
    throw new TypeError(`Provider usage metadata field ${field} must be a finite number.`)
  }

  if (item < 0) {
    throw new TypeError(`Provider usage metadata field ${field} must be non-negative.`)
  }

  return {[field]: item}
}

function parseOptionalMetadataString(value: Record<string, unknown>, field: 'model' | 'requestId'): Partial<Pick<ProviderResponseMetadata, 'model' | 'requestId'>> {
  const item = value[field]

  if (item === undefined) {
    return {}
  }

  if (typeof item !== 'string' || item.trim() === '' || item.trim() !== item) {
    throw new TypeError(`Provider metadata field ${field} must be clean non-empty string; no metadata field omission fallback is allowed.`)
  }

  return {[field]: item}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
