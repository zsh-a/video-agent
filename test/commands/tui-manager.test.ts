import type {TuiSnapshot} from '../../src/ui/tui-model.js'

import {expect} from '#test/expect'
import {renderToString} from 'ink'
import {createElement as h} from 'react'

import {TuiManagerScreen} from '../../src/ui/tui-manager.js'

describe('interactive tui manager', () => {
  it('renders the project dashboard and management chrome', () => {
    const output = renderToString(h(TuiManagerScreen, {
      activeView: 'dashboard',
      commands: [],
      loading: false,
      selectedActionIndex: 0,
      selectedArtifactIndex: 0,
      selectedProjectIndex: 0,
      snapshot: createSnapshot(),
    }), {columns: 140})

    expect(output).to.include('video-agent manager')
    expect(output).to.include('workspace')
    expect(output).to.include('/tmp/workspace')
    expect(output).to.include('Projects')
    expect(output).to.include('demo')
    expect(output).to.include('1:Dashboard')
    expect(output).to.include('quality 1 issues')
    expect(output).to.include('1 issues, 0 errors')
    expect(output).to.include('Pipeline')
    expect(output).to.include('ingest')
    expect(output).to.include('← → tabs')
  })

  it('renders actions, commands, and action output views', () => {
    const snapshot = createSnapshot()
    const actionOutput = renderToString(h(TuiManagerScreen, {
      activeView: 'actions',
      commands: [],
      loading: false,
      selectedActionIndex: 1,
      selectedArtifactIndex: 0,
      selectedProjectIndex: 0,
      snapshot,
    }), {columns: 140})

    expect(actionOutput).to.include('Actions')
    expect(actionOutput).to.include('Inspect')
    expect(actionOutput).to.include('Quality')
    expect(actionOutput).to.include('Rerun')
    expect(actionOutput).to.include('confirm')

    const commandOutput = renderToString(h(TuiManagerScreen, {
      activeView: 'commands',
      commands: [{
        category: 'inspect',
        command: 'vagent tui --project demo --action status',
        description: 'Inspect job state.',
        id: 'inspect-status',
        label: 'Inspect status',
        priority: 25,
      }],
      loading: false,
      selectedActionIndex: 0,
      selectedArtifactIndex: 0,
      selectedProjectIndex: 0,
      snapshot,
    }), {columns: 140})

    expect(commandOutput).to.include('Guided Commands')
    expect(commandOutput).to.include('Inspect status')
    expect(commandOutput).to.include('vagent tui --project demo --action status')

    const resultOutput = renderToString(h(TuiManagerScreen, {
      activeView: 'output',
      commands: [],
      loading: false,
      output: 'Action: status demo\nProject: demo',
      selectedActionIndex: 0,
      selectedArtifactIndex: 0,
      selectedProjectIndex: 0,
      snapshot,
    }), {columns: 140})

    expect(resultOutput).to.include('Action Output')
    expect(resultOutput).to.include('Action: status demo')
    expect(resultOutput).to.include('Project: demo')
  })
})

function createSnapshot(): TuiSnapshot {
  return {
    artifactIntegrity: {
      changed: [],
      checked: 2,
      manifestPath: '/tmp/workspace/projects/demo/artifacts/artifact-manifest.json',
      missing: [],
      ok: true,
      schemaInvalid: [],
      summary: {
        changed: 0,
        checked: 2,
        errors: 0,
        missing: 0,
        schemaInvalid: 0,
        untracked: 0,
        warnings: 0,
      },
      untracked: [],
    },
    artifacts: [
      {
        kind: 'json',
        name: 'quality-report.json',
        path: '/tmp/workspace/projects/demo/artifacts/quality-report.json',
        size: 120,
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
    ],
    events: [
      {
        event: {
          projectId: 'demo',
          stage: 'ingest',
          time: '2026-06-18T00:00:00.000Z',
          type: 'stage:start',
        },
        kind: 'pipeline',
        time: '2026-06-18T00:00:00.000Z',
      },
    ],
    projects: [
      {
        projectDir: '/tmp/workspace/projects/demo',
        projectId: 'demo',
        status: 'running',
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
    ],
    selected: {
      artifacts: ['quality-report.json'],
      job: {
        createdAt: '2026-06-18T00:00:00.000Z',
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: [
          {
            attempt: 1,
            name: 'ingest',
            status: 'running',
          },
        ],
        status: 'running',
        updatedAt: '2026-06-18T00:00:00.000Z',
        version: 1,
      },
      projectDir: '/tmp/workspace/projects/demo',
      projectId: 'demo',
      summary: {
        events: {
          count: 1,
        },
        providers: {
          byRole: {
            asr: {costs: {}, failed: 0, succeeded: 1, total: 1},
            tts: {costs: {}, failed: 0, succeeded: 0, total: 0},
            vlm: {costs: {}, failed: 0, succeeded: 0, total: 0},
          },
          costs: {},
          failed: 0,
          succeeded: 1,
          total: 1,
        },
        quality: {
          errors: 0,
          issues: 1,
          warnings: 1,
        },
        render: {
          audioInputs: 0,
          audioQualityErrors: 0,
          audioQualityWarnings: 0,
          audioWarnings: 0,
          missingVoiceovers: 0,
          outputErrors: 0,
          outputWarnings: 0,
          rendered: false,
          subtitleErrors: 0,
          subtitleWarnings: 0,
          templateErrors: 0,
          templateWarnings: 0,
          visualErrors: 0,
          visualWarnings: 0,
        },
      },
    },
    workspaceDir: '/tmp/workspace',
  }
}
