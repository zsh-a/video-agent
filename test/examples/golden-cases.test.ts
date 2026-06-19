import {mkdtemp, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {expect} from '#test/expect'

interface GoldenCaseManifest {
  cases: GoldenCase[]
  version: number
}

interface GoldenCase {
  expected: {
    maxSlides: number
    minSlides: number
    mustMention: string[]
    qualityMustPass: boolean
    requiredSlideTypes: string[]
  }
  fixturePolicy?: string
  id: string
  input: {
    kind: string
    path: string
  }
  language: string
  mode: string
  pipeline: string
  run: {
    command: string
  }
  source: {
    downloadUrl: string
    license: string
    licenseUrl: string
    name: string
  }
}

describe('golden case manifest', () => {
  it('defines runnable Deck cases with attribution and review expectations', async () => {
    const manifestPath = join(process.cwd(), 'examples', 'golden-cases', 'cases.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as GoldenCaseManifest

    expect(manifest.version).to.equal(1)
    expect(manifest.cases.map((goldenCase) => goldenCase.id)).to.deep.equal([
      'md-k8s-pods-en',
      'md-github-rest-api',
      'md-turing-way-cn',
      'md-ossf-scorecard-checks',
      'audio-osr-en-clean',
      'audio-osr-zh-clean',
      'audio-librispeech-dev-clean',
      'audio-harper-valley-dialog',
    ])

    for (const goldenCase of manifest.cases) {
      expect(goldenCase.pipeline).to.equal('deck')
      expect(['script-generated', 'audio-anchored']).to.include(goldenCase.mode)
      expect(['audio', 'markdown']).to.include(goldenCase.input.kind)
      expect(goldenCase.input.path).to.match(/^fixtures\/[^/]+\/input\.(md|wav)$/)
      expect(goldenCase.source.downloadUrl).to.match(/^https:\/\//)
      expect(goldenCase.source.license.length).to.be.greaterThan(0)
      expect(goldenCase.source.licenseUrl).to.match(/^https:\/\//)
      expect(goldenCase.run.command).to.include(goldenCase.input.path)
      expect(goldenCase.expected.minSlides).to.be.greaterThan(0)
      expect(goldenCase.expected.maxSlides + 1).to.be.greaterThan(goldenCase.expected.minSlides)
      expect(goldenCase.expected.requiredSlideTypes).to.include('hero')
      expect(goldenCase.expected.mustMention.length).to.be.greaterThan(0)
      expect(goldenCase.expected.qualityMustPass).to.equal(true)
    }

    const manualCases = manifest.cases.filter((goldenCase) => goldenCase.fixturePolicy === 'manual-excerpt')

    expect(manualCases.map((goldenCase) => goldenCase.id)).to.deep.equal([
      'audio-librispeech-dev-clean',
      'audio-harper-valley-dialog',
    ])
  })

  it('runs the golden runner in dry-run mode and writes a report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'video-agent-golden-run-'))
    const child = Bun.spawn([
      'bun',
      'examples/golden-cases/run-cases.ts',
      '--dry-run',
      '--case',
      'md-k8s-pods-en',
      '--output-dir',
      outputDir,
    ], {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(exitCode).to.equal(0)
    expect(stderr).to.equal('')
    expect(stdout).to.include('PLANNED md-k8s-pods-en')

    const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8')) as {
      results: Array<{caseId: string; projectId: string; runCommand: string; status: string}>
      summary: {planned: number; total: number}
    }

    expect(report.summary.total).to.equal(1)
    expect(report.summary.planned).to.equal(1)
    expect(report.results[0]).to.deep.include({
      caseId: 'md-k8s-pods-en',
      status: 'planned',
    })
    expect(report.results[0]?.projectId).to.match(/^golden-md-k8s-pods-en-\d{4}-\d{2}-\d{2}T/)
    expect(report.results[0]?.runCommand).to.include(`--project-id ${report.results[0]?.projectId}`)
  })
})
