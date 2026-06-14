export interface ProviderValidationIssue {
  code: string
  message: string
  path: string[]
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
