import {expect} from '#test/expect'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {DECK_FRAME_MANIFEST_ARTIFACT_NAME} from '../../../packages/runtime/src/artifacts/deck-artifact-constants.js'
import {createProjectWorkspace} from '../../../packages/runtime/src/shared/workspace.js'
import {readReusableDeckFrameManifest} from '../../../packages/pipeline-deck/src/render/frames/manifest.js'

describe('Deck frame manifest reuse', () => {
  it('distinguishes missing or mismatched manifests from invalid manifest artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-frame-manifest-'))

    try {
      const workspace = await createProjectWorkspace({projectId: 'demo', workspaceDir: root})
      const expected = {
        fps: 30,
        outputDir: join(workspace.rendersDir, 'deck-frames'),
        renderer: 'playwright' as const,
        sourceSha256: 'expected-source',
      }

      expect(await readReusableDeckFrameManifest(workspace, expected)).to.equal(undefined)

      await workspace.store.writeJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME, createReusableManifest({
        outputDir: 'renders/deck-frames',
        sourceSha256: 'different-source',
      }))
      expect(await readReusableDeckFrameManifest(workspace, expected)).to.equal(undefined)

      await workspace.store.writeJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME, {version: 1})
      const schemaError = await captureAsyncError(() => readReusableDeckFrameManifest(workspace, expected))

      expect(String(schemaError)).to.include('duration')

      await writeFile(workspace.store.resolve(DECK_FRAME_MANIFEST_ARTIFACT_NAME), 'not json\n')
      const jsonError = await captureAsyncError(() => readReusableDeckFrameManifest(workspace, expected))

      expect(String(jsonError)).to.include('invalid JSON')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function createReusableManifest(input: {outputDir: string; sourceSha256: string}) {
  return {
    duration: 1,
    fps: 30,
    frameCount: 1,
    frames: [
      {
        frame: 1,
        path: `${input.outputDir}/frame-000001.png`,
        slideId: 'slide-001',
        time: 0,
      },
    ],
    outputDir: input.outputDir,
    pattern: `${input.outputDir}/frame-%06d.png`,
    renderer: 'playwright',
    sourceSha256: input.sourceSha256,
    viewport: {
      height: 1080,
      width: 1920,
    },
  }
}

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }

  throw new Error('Expected function to throw.')
}
