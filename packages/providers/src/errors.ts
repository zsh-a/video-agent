export interface ProviderValidationIssue {
  code: string
  message: string
  path: string[]
}

export type ProviderExecutionRole = 'asr' | 'tts' | 'vlm'

export interface ProviderExecutionErrorOptions {
  cause?: unknown
  code: string
  details?: Record<string, unknown>
  message: string
  retryable?: boolean
  role: ProviderExecutionRole
}

export class ProviderExecutionError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
  readonly retryable: boolean
  readonly role: ProviderExecutionRole

  constructor(options: ProviderExecutionErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : {cause: options.cause})
    this.code = options.code
    this.details = options.details
    this.name = 'ProviderExecutionError'
    this.retryable = options.retryable ?? false
    this.role = options.role
  }
}

export class ProviderResponseValidationError extends TypeError {
  readonly issues: ProviderValidationIssue[]
  readonly role: 'asr' | 'tts' | 'vlm'

  constructor(role: ProviderResponseValidationError['role'], message: string, issues: ProviderValidationIssue[]) {
    const firstIssue = issues[0]
    const detail = firstIssue === undefined ? '' : ` (${firstIssue.path.join('.') || '<root>'}: ${firstIssue.message})`

    super(`${message}${detail}`)
    this.issues = issues
    this.role = role
    this.name = 'ProviderResponseValidationError'
  }
}
