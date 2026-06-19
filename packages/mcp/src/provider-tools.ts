import type {ProviderSmokeTestRole} from '@video-agent/runtime'
import type {McpToolDefinition} from './toolkit.js'

import {
  checkRuntimeHealth,
  createProviderEnvironmentShellTemplate,
  readProviderEnvironment,
  runProviderSmokeTest,
} from '@video-agent/runtime'
import {
  booleanSchema,
  createToolDefinition,
  enumSchema,
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalString,
  readOptionalStringRecord,
  stringRecordSchema,
  stringSchema,
} from './toolkit.js'

const PROVIDER_TEST_ROLES = ['all', 'asr', 'tts', 'vlm'] as const

export const PROVIDER_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  createToolDefinition('video_agent_doctor', 'Check runtime, workspace, provider config, and media binary health.', {
    env: stringRecordSchema('Explicit environment variables for provider health checks. When set, only these values are checked and current shell environment is ignored.'),
  }, (args, workspaceDir) => checkRuntimeHealth({env: readOptionalStringRecord(args, 'env'), workspaceDir})),
  createToolDefinition('video_agent_provider_env', 'Read provider environment variable requirements without exposing configured values.', {
    env: stringRecordSchema('Explicit environment variables to inspect. When set, only these values are checked and current shell environment is ignored.'),
    includeOptional: booleanSchema('When shellTemplate is true, include optional provider variables as active exports. Defaults to commented optional variables.'),
    shellTemplate: booleanSchema('When true, include a non-secret shell export template for the current provider config.'),
  }, async (args, workspaceDir) => {
    const report = await readProviderEnvironment(workspaceDir, readOptionalStringRecord(args, 'env'))

    if (readOptionalBoolean(args, 'shellTemplate') === true) {
      return {
        report,
        shellTemplate: createProviderEnvironmentShellTemplate(report, {includeOptional: readOptionalBoolean(args, 'includeOptional')}),
      }
    }

    return report
  }),
  createToolDefinition('video_agent_provider_test', 'Run smoke tests against configured ASR, VLM, and TTS providers.', {
    env: stringRecordSchema('Explicit environment variables for provider smoke tests. When set, only these values are checked and current shell environment is ignored.'),
    framePath: stringSchema('Sample frame path for VLM smoke tests. Defaults to a synthetic placeholder path.'),
    mediaPath: stringSchema('Sample media path for ASR smoke tests. Defaults to a synthetic placeholder path.'),
    role: enumSchema(PROVIDER_TEST_ROLES, 'Provider role to test. Defaults to all.'),
    text: stringSchema('Sample narration text for TTS smoke tests.'),
  }, (args, workspaceDir) => runProviderSmokeTest({
    env: readOptionalStringRecord(args, 'env'),
    framePath: readOptionalString(args, 'framePath'),
    mediaPath: readOptionalString(args, 'mediaPath'),
    roles: resolveProviderSmokeTestRoles(readOptionalEnum(args, 'role', PROVIDER_TEST_ROLES)),
    text: readOptionalString(args, 'text'),
    workspaceDir,
  })),
]

function resolveProviderSmokeTestRoles(role: typeof PROVIDER_TEST_ROLES[number] | undefined): ProviderSmokeTestRole[] | undefined {
  if (role === undefined || role === 'all') {
    return undefined
  }

  return [role]
}
