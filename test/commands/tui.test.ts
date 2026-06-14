import {expect} from 'chai'

import {createTuiCommandSuggestions, formatTuiActionResult, formatTuiSnapshot} from '../../src/commands/tui.js'

describe('tui command', () => {
  it('formats dashboard actions without a banner', () => {
    expect(formatTuiActionResult({type: 'dashboard'})).to.equal('')
  })

  it('formats rerun and worker action results', () => {
    expect(formatTuiActionResult({
      fromStage: 'script',
      projectId: 'demo',
      status: 'completed',
      type: 'rerun',
    })).to.equal('Action: rerun demo from script -> completed')
    expect(formatTuiActionResult({
      dryRun: true,
      recovered: 0,
      skipped: 1,
      type: 'worker',
    })).to.equal('Action: worker dry-run -> recovered 0, skipped 1')
  })

  it('formats command action results', () => {
    expect(formatTuiActionResult({
      commands: [
        {
          command: 'bun run dev status demo',
          label: 'Inspect status',
        },
      ],
      type: 'commands',
    })).to.equal([
      'Action: commands',
      '  Inspect status           bun run dev status demo',
    ].join('\n'))
  })

  it('formats artifact action results with a content preview', () => {
    expect(formatTuiActionResult({
      artifact: {
        kind: 'json',
        name: 'quality-report.json',
        path: '/tmp/quality-report.json',
        size: 42,
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
      content: {
        ok: true,
      },
      projectId: 'demo',
      type: 'artifact',
    })).to.equal([
      'Action: artifact demo/quality-report.json',
      'Kind: json',
      'Size: 42B',
      'Preview: {"ok":true}',
    ].join('\n'))
  })

  it('formats an empty workspace dashboard', () => {
    expect(formatTuiSnapshot({artifacts: [], events: [], projects: [], workspaceDir: '.video-agent'}, {artifactLimit: 8, commandPrefix: 'bun run dev', eventLimit: 6})).to.equal([
      'Video Agent TUI',
      'Workspace: .video-agent',
      'Projects: 0',
      '',
      'No projects found.',
    ].join('\n'))
  })

  it('formats a selected project dashboard', () => {
    const output = formatTuiSnapshot({
      artifacts: [
        {
          kind: 'json',
          name: 'quality-report.json',
          path: '/tmp/quality-report.json',
          size: 42,
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      events: [
        {
          event: {
            projectId: 'demo',
            stage: 'ingest',
            time: '2026-06-15T00:00:00.000Z',
            type: 'stage:start',
          },
          kind: 'pipeline',
          time: '2026-06-15T00:00:00.000Z',
        },
      ],
      projects: [
        {
          projectDir: '/tmp/project',
          projectId: 'demo',
          status: 'running',
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      selected: {
        artifacts: ['quality-report.json', 'timeline.json'],
        job: {
          createdAt: '2026-06-15T00:00:00.000Z',
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
          updatedAt: '2026-06-15T00:00:00.000Z',
          version: 1,
        },
        projectDir: '/tmp/project',
        projectId: 'demo',
        summary: {
          events: {
            count: 1,
          },
          providers: {
            byRole: {
              asr: {costs: {}, failed: 0, succeeded: 0, total: 0},
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
      workspaceDir: '.video-agent',
    }, {artifactLimit: 8, commandPrefix: 'bun run dev', eventLimit: 6})

    expect(output).to.include('Selected: demo')
    expect(output).to.include('  ingest       running attempt=1')
    expect(output).to.include('Quality: 1 issues (0 errors, 1 warnings)')
    expect(output).to.include('Providers: 1 calls (0 failed)')
    expect(output).to.include('Render: none')
    expect(output).to.include('quality-report.json')
    expect(output).to.include('2026-06-15T00:00:00.000Z pipeline stage:start ingest')
    expect(output).to.include('Commands')
    expect(output).to.include('Inspect status')
    expect(output).to.include('bun run dev status demo --workspace .video-agent')
    expect(output).to.include('Rerun from ingest')
  })

  it('creates copyable command suggestions with quoted arguments', () => {
    const commands = createTuiCommandSuggestions({
      artifacts: [
        {
          kind: 'json',
          name: 'quality report.json',
          path: '/tmp/quality report.json',
          size: 42,
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      events: [],
      projects: [],
      selected: {
        artifacts: ['quality report.json'],
        job: {
          createdAt: '2026-06-15T00:00:00.000Z',
          inputPath: '/tmp/input.mp4',
          projectId: 'demo project',
          stages: [
            {
              name: 'quality',
              status: 'pending',
            },
          ],
          status: 'running',
          updatedAt: '2026-06-15T00:00:00.000Z',
          version: 1,
        },
        projectDir: '/tmp/project',
        projectId: 'demo project',
        summary: {
          events: {count: 0},
          providers: {
            byRole: {
              asr: {costs: {}, failed: 0, succeeded: 0, total: 0},
              tts: {costs: {}, failed: 0, succeeded: 0, total: 0},
              vlm: {costs: {}, failed: 0, succeeded: 0, total: 0},
            },
            costs: {},
            failed: 0,
            succeeded: 0,
            total: 0,
          },
          quality: {
            errors: 0,
            issues: 0,
            warnings: 0,
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
      workspaceDir: 'workspace dir',
    }, {commandPrefix: 'vagent'})

    expect(commands.map((item) => item.command)).to.include("vagent status 'demo project' --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent tui --project 'demo project' --action artifact --artifact 'quality report.json' --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent tui --project 'demo project' --action rerun --from-stage quality --workspace 'workspace dir'")
  })
})
