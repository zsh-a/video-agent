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
    ...(typeof value.model === 'string' ? {model: value.model} : {}),
    ...(typeof value.requestId === 'string' ? {requestId: value.requestId} : {}),
    ...(value.usage === undefined ? {} : {usage: parseUsageMetadata(value.usage)}),
  }
}

function parseCostMetadata(value: unknown): ProviderCostMetadata {
  if (!isRecord(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || typeof value.currency !== 'string') {
    throw new TypeError('Provider cost metadata must include numeric amount and string currency.')
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

  return {[field]: item}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
