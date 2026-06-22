import type {McpToolDefinition} from './toolkit.js'

import {
  PROVIDER_SMOKE_TEST_ROLE_OPTIONS,
  checkRuntimeHealth,
  createProviderEnvironmentShellTemplate,
  readProviderEnvironment,
  resolveProviderSmokeTestRoles,
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
  createToolDefinition('video_agent_provider_test', 'Run smoke tests against configured ASR, VLM, and TTS providers. ASR requires mediaPath, VLM requires framePath, and TTS requires text when the selected role includes them.', {
    env: stringRecordSchema('Explicit environment variables for provider smoke tests. When set, only these values are checked and current shell environment is ignored.'),
    framePath: stringSchema('Sample frame path for VLM smoke tests. Required when role is all or vlm.'),
    mediaPath: stringSchema('Sample media path for ASR smoke tests. Required when role is all or asr.'),
    role: enumSchema(PROVIDER_SMOKE_TEST_ROLE_OPTIONS, 'Provider role to test. Defaults to all.'),
    text: stringSchema('Sample narration text for TTS smoke tests. Required when role is all or tts.'),
  }, (args, workspaceDir) => runProviderSmokeTest({
    env: readOptionalStringRecord(args, 'env'),
    framePath: readOptionalString(args, 'framePath'),
    mediaPath: readOptionalString(args, 'mediaPath'),
    roles: resolveProviderSmokeTestRoles(readOptionalEnum(args, 'role', PROVIDER_SMOKE_TEST_ROLE_OPTIONS)),
    text: readOptionalString(args, 'text'),
    workspaceDir,
  })),
]
