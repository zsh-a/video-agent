import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ProjectQualityReport} from '../../packages/runtime/src/project-quality.js'

import {createTuiCommandSuggestions, formatTuiActionResult, formatTuiCommandSelector, formatTuiSnapshot, resolveTuiCommandSelection, runTuiAction} from '../../src/commands/tui.js'

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
      action: 'rerun',
      error: {
        changedArtifacts: ['timeline.json'],
        code: 'checkpoint_invalid',
        fromStage: 'quality',
        message: 'Cannot resume from quality; checkpoint artifact issue(s): missing: narration.json; changed: timeline.json.',
        missingArtifacts: ['narration.json'],
        name: 'PipelineCheckpointError',
        schemaInvalidArtifacts: [],
        untrackedArtifacts: [],
      },
      projectId: 'demo',
      type: 'checkpoint-error',
    })).to.equal([
      'Action: rerun demo from quality -> checkpoint-invalid',
      '  Checkpoint blocked: cannot resume from quality.',
      '  Missing artifacts: narration.json',
      '  Changed artifacts: timeline.json',
      '  Schema invalid artifacts: none',
      '  Untracked required artifacts: none',
      '  Message: Cannot resume from quality; checkpoint artifact issue(s): missing: narration.json; changed: timeline.json.',
    ].join('\n'))
    expect(formatTuiActionResult({
      dryRun: true,
      recovered: 0,
      results: [],
      skipped: 1,
      type: 'worker',
    })).to.equal('Action: worker dry-run -> recovered 0, skipped 1')
    expect(formatTuiActionResult({
      dryRun: true,
      recovered: 0,
      results: [
        {
          changedArtifacts: ['timeline.json'],
          error: 'Checkpoint IR validation failed.',
          fromStage: 'quality',
          missingArtifacts: ['narration.json'],
          projectId: 'demo',
          schemaInvalidArtifacts: ['clip-plan.json'],
          skipReason: 'checkpoint-invalid',
          status: 'skipped',
          untrackedArtifacts: ['render-plan.json'],
          validationIssues: [
            {
              code: 'too_small',
              message: 'Too small: expected string to have >=1 characters',
              path: ['source'],
            },
          ],
        },
      ],
      skipped: 1,
      type: 'worker',
    })).to.equal([
      'Action: worker dry-run -> recovered 0, skipped 1',
      '  demo skipped from quality (checkpoint-invalid) - Checkpoint IR validation failed.',
      '    missing: narration.json',
      '    changed: timeline.json',
      '    schema invalid: clip-plan.json',
      '    untracked: render-plan.json',
      '    source: Too small: expected string to have >=1 characters',
    ].join('\n'))
  })

  it('formats export action results', () => {
    expect(formatTuiActionResult({
      result: {
        artifactPath: '/tmp/project/artifacts/export-output.json',
        cleanOutput: true,
        format: 'hyperframes',
        outputPath: '/tmp/out',
        projectDir: '/tmp/project',
        projectId: 'demo',
        requireQuality: true,
        sourcePath: '/tmp/project/renders/hyperframes',
      },
      type: 'export',
    })).to.equal([
      'Action: export demo -> hyperframes',
      'Source: /tmp/project/renders/hyperframes',
      'Output: /tmp/out',
      'Clean output: yes',
      'Quality gate: required',
      'Artifact: /tmp/project/artifacts/export-output.json',
    ].join('\n'))
    expect(formatTuiActionResult({
      action: 'export',
      error: {
        code: 'export_quality_failed',
        legacyCode: 'export.quality_failed',
        message: 'Project demo did not pass quality checks.',
        name: 'ExportQualityError',
      },
      projectId: 'demo',
      quality: createProjectQualityReport(),
      type: 'export-quality-error',
    })).to.equal([
      'Action: export demo -> export-quality-failed',
      '  Export blocked: project demo did not pass quality checks.',
      '  Quality: 36 errors, 48 warnings',
      '  Pipeline: 2 errors, 3 warnings',
      '  Render: rendered, 33 errors, 45 warnings, output 5/6, subtitle 7/8, audio 1/9, template 9/10, visual 11/12',
      '  Artifacts: not ok (1 changed, 1 missing, 1 schema invalid, 2 untracked)',
    ].join('\n'))
  })

  it('formats render action results', () => {
    expect(formatTuiActionResult({
      result: {
        artifactPath: '/tmp/project/artifacts/render-output.json',
        entryHtml: '/tmp/project/renders/hyperframes/index.html',
        outputDir: '/tmp/project/renders/hyperframes',
        projectDir: '/tmp/project',
        projectId: 'demo',
        renderer: 'hyperframes',
        templateQuality: {
          errors: 0,
          issues: [],
          ok: true,
          warnings: 0,
        },
      },
      type: 'render',
    })).to.equal([
      'Action: render demo -> hyperframes',
      'Output: /tmp/project/renders/hyperframes',
      'Entry: /tmp/project/renders/hyperframes/index.html',
      'Validated: no',
      'Rendered: no',
      'Artifact: /tmp/project/artifacts/render-output.json',
    ].join('\n'))
  })

  it('runs render action against a HyperFrames project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-tui-render-'))
    const outputPath = join(root, 'hyperframes-output')

    try {
      await createRenderableProject(root, 'demo')

      const result = await runTuiAction({
        action: 'render',
        artifactLimit: 5,
        commandPrefix: 'vagent',
        exportFormat: 'video',
        exportRequireQuality: true,
        fromStage: 'quality',
        projectId: 'demo',
        providerRole: 'all',
        renderOutputPath: outputPath,
        renderRenderer: 'hyperframes',
        status: 'active',
        workspaceDir: root,
      })

      expect(result.type).to.equal('render')
      expect(result.type === 'render' && result.result.renderer).to.equal('hyperframes')
      expect(result.type === 'render' && result.result.renderer === 'hyperframes' && result.result.outputDir).to.equal(outputPath)
      expect(await readFile(join(outputPath, 'index.html'), 'utf8')).to.contain('data-duration="1"')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('runs export action against a rendered project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-tui-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders')
      const outputPath = join(root, 'out.mp4')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'final.mp4'), 'video')

      const result = await runTuiAction({
        action: 'export',
        artifactLimit: 5,
        commandPrefix: 'vagent',
        exportCleanOutput: false,
        exportFormat: 'video',
        exportOutputPath: outputPath,
        exportRequireQuality: false,
        fromStage: 'quality',
        projectId: 'demo',
        providerRole: 'all',
        renderRenderer: 'ffmpeg',
        status: 'active',
        workspaceDir: root,
      })

      expect(result.type).to.equal('export')
      expect(result.type === 'export' && result.result.outputPath).to.equal(outputPath)
      expect(await readFile(outputPath, 'utf8')).to.equal('video')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('formats provider test action results', () => {
    expect(formatTuiActionResult({
      report: {
        ok: true,
        results: [
          {
            durationMs: 12,
            metadata: {
              model: 'example',
              requestId: 'req-1',
            },
            output: {
              characters: 42,
              segments: 1,
              type: 'transcript',
            },
            provider: 'command',
            role: 'asr',
            status: 'succeeded',
          },
        ],
        summary: {
          failed: 0,
          failedRoles: [],
          succeeded: 1,
          total: 1,
        },
        workspaceDir: '.video-agent',
      },
      type: 'provider-test',
    })).to.equal([
      'Action: provider-test -> ok (1/1 succeeded, 0 failed)',
      '  asr:command succeeded 12ms segments=1 characters=42 request=req-1 model=example',
    ].join('\n'))
  })

  it('formats command action results', () => {
    expect(formatTuiActionResult({
      commands: [
        {
          category: 'inspect',
          command: 'bun run dev status demo',
          description: 'Inspect job state.',
          id: 'inspect-status',
          label: 'Inspect status',
          priority: 25,
        },
      ],
      type: 'commands',
    })).to.equal([
      'Action: commands',
      '  Inspect status           bun run dev status demo',
    ].join('\n'))
  })

  it('formats guided selector action results', () => {
    const selected = {
      category: 'inspect' as const,
      command: 'bun run dev status demo',
      description: 'Inspect job state.',
      id: 'inspect-status',
      label: 'Inspect status',
      priority: 25,
    }

    expect(formatTuiActionResult({
      commands: [selected],
      selected,
      type: 'select',
    })).to.equal([
      'Action: select -> inspect-status',
      'Command: bun run dev status demo',
    ].join('\n'))
    expect(formatTuiActionResult({
      commands: [selected],
      type: 'select',
    })).to.equal('Action: select -> no action selected')
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
      artifactIntegrity: {
        changed: [],
        checked: 3,
        manifestPath: '/tmp/artifact-manifest.json',
        missing: [{name: 'narration.json', reason: 'missing'}],
        ok: false,
        schemaInvalid: [{issues: [{code: 'invalid_type', message: 'Required', path: ['scenes']}], name: 'storyboard.json'}],
        summary: {
          changed: 0,
          checked: 3,
          errors: 2,
          missing: 1,
          schemaInvalid: 1,
          untracked: 1,
          warnings: 1,
        },
        untracked: ['render-output.json'],
      },
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
    expect(output).to.include('Artifact Integrity: needs attention, 2 errors, 1 warnings, 3 checked, 1 missing, 0 changed, 1 schema invalid, 1 untracked')
    expect(output).to.include('quality-report.json')
    expect(output).to.include('2026-06-15T00:00:00.000Z pipeline stage:start ingest')
    expect(output).to.include('Commands')
    expect(output).to.include('Test providers')
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

    expect(commands.map((item) => item.id).slice(0, 3)).to.deep.equal([
      'open-dashboard',
      'rerun-suggested-stage',
      'watch-dashboard',
    ])
    expect(commands.find((item) => item.id === 'rerun-suggested-stage')).to.include({
      category: 'rerun',
      description: 'Rerun the focused project from the first unfinished stage, quality.',
      priority: 15,
    })
    expect(commands.find((item) => item.id === 'provider-test')).to.include({
      category: 'provider',
      description: 'Run ASR, VLM, and TTS provider smoke tests for the current workspace.',
    })
    expect(commands.find((item) => item.id === 'verify-artifacts')).to.include({
      category: 'artifact',
      description: 'Verify artifact manifest hashes and known IR/provider schemas.',
    })
    expect(commands.map((item) => item.command)).to.include("vagent status 'demo project' --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent quality 'demo project' --details --json --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent artifacts 'demo project' --verify --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent visual 'demo project' --json --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent tui --action provider-test --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent tui --project 'demo project' --action artifact --artifact 'quality report.json' --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent tui --project 'demo project' --action rerun --from-stage quality --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent export 'demo project' --require-quality --workspace 'workspace dir'")
    expect(commands.map((item) => item.command)).to.include("vagent export 'demo project' --format hyperframes --clean-output --require-quality --workspace 'workspace dir'")
  })

  it('formats and resolves guided command selections', () => {
    const commands = [
      {
        category: 'dashboard' as const,
        command: 'vagent tui --project demo',
        description: 'Open the focused project dashboard once.',
        id: 'open-dashboard',
        label: 'Open dashboard',
        priority: 10,
      },
      {
        category: 'inspect' as const,
        command: 'vagent status demo',
        description: 'Inspect job state.',
        id: 'inspect-status',
        label: 'Inspect status',
        priority: 25,
      },
    ]

    expect(formatTuiCommandSelector(commands)).to.deep.equal([
      'Guided Actions',
      '   1. Open dashboard [dashboard]',
      '      Open the focused project dashboard once.',
      '      vagent tui --project demo',
      '   2. Inspect status [inspect]',
      '      Inspect job state.',
      '      vagent status demo',
    ])
    expect(resolveTuiCommandSelection(commands, '2')).to.equal(commands[1])
    expect(resolveTuiCommandSelection(commands, 'inspect-status')).to.equal(commands[1])
    expect(resolveTuiCommandSelection(commands, 'open dashboard')).to.equal(commands[0])
    expect(resolveTuiCommandSelection(commands, '')).to.equal(undefined)
    expect(resolveTuiCommandSelection(commands, 'missing')).to.equal(undefined)
  })
})

function createProjectQualityReport(): ProjectQualityReport {
  return {
    artifacts: {
      changed: [{
        actualSha256: 'actual',
        actualSize: 12,
        expectedSha256: 'expected',
        expectedSize: 10,
        name: 'timeline.json',
      }],
      checked: 3,
      manifestPath: '/tmp/artifact-manifest.json',
      missing: [{name: 'narration.json', reason: 'missing'}],
      ok: false,
      schemaInvalid: [{issues: [{code: 'invalid_type', message: 'Required', path: ['scenes']}], name: 'storyboard.json'}],
      summary: {
        changed: 1,
        checked: 3,
        errors: 3,
        missing: 1,
        schemaInvalid: 1,
        untracked: 2,
        warnings: 2,
      },
      untracked: ['render-output.json', 'quality-report.json'],
    },
    generatedAt: '2026-06-15T00:00:00.000Z',
    ok: false,
    pipeline: {
      errors: 2,
      issues: 5,
      warnings: 3,
    },
    projectId: 'demo',
    render: {
      audioInputs: 1,
      audioQualityErrors: 1,
      audioQualityWarnings: 2,
      audioWarnings: 3,
      missingVoiceovers: 4,
      outputErrors: 5,
      outputWarnings: 6,
      rendered: true,
      renderer: 'hyperframes',
      subtitleErrors: 7,
      subtitleWarnings: 8,
      templateErrors: 9,
      templateWarnings: 10,
      visualErrors: 11,
      visualWarnings: 12,
    },
    summary: {
      errors: 36,
      warnings: 48,
    },
  }
}

async function createRenderableProject(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  await Promise.all([
    writeFile(
      join(artifactsDir, 'timeline.json'),
      `${JSON.stringify({
        duration: 1,
        fps: 30,
        items: [],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'storyboard.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        scenes: [
          {
            duration: 1,
            evidence: [],
            id: 'scene-1',
            narration: 'hello',
            start: 0,
            visualStyle: 'documentary',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'narration.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        segments: [
          {
            duration: 1,
            id: 'narration-1',
            start: 0,
            text: 'hello',
          },
        ],
        version: 1,
      })}\n`,
    ),
  ])
}
