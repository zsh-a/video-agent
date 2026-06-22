import {SourceManifestSchema} from '@video-agent/ir'
import {probeMedia} from '@video-agent/media'
import {resolve} from 'node:path'

import {MEDIA_INFO_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, createProjectAgentRuntime, createProjectWorkspace, refreshArtifactManifest} from '@video-agent/runtime'
import type {CreateFilmIngestProjectOptions, CreateFilmIngestProjectResult} from './types.js'
import {createSourceManifest} from '../planning/source.js'
import {createFilmJobStore} from '../shared/stage-runtime.js'
import {assertFileExists, hashFile} from '../shared/utils.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES, FILM_STAGE_IDS} from '../pipeline.js'

export async function createFilmIngestProject(options: CreateFilmIngestProjectOptions): Promise<CreateFilmIngestProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const jobStore = await createFilmJobStore(workspace.projectId, workspace.workspaceDir)

  await jobStore.initialize({
    inputPath,
    pipeline: FILM_PIPELINE_DEFINITION.kind,
    projectId: workspace.projectId,
    stages: FILM_PIPELINE_STAGES,
  })
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await agent.startRun('Film stage ingest started')
  await agent.startStage(FILM_STAGE_IDS.ingest)

  try {
    const [mediaInfo, sourceHash] = await Promise.all([
      probeMedia(inputPath),
      hashFile(inputPath),
    ])
    const sourceManifest = SourceManifestSchema.parse(createSourceManifest(mediaInfo, sourceHash))
    const artifacts = {
      mediaInfo: await workspace.store.writeJson(MEDIA_INFO_ARTIFACT_NAME, mediaInfo),
      sourceManifest: await workspace.store.writeJson(SOURCE_MANIFEST_ARTIFACT_NAME, sourceManifest),
    }

    await agent.completeStage(FILM_STAGE_IDS.ingest)
    await agent.completeRun('Film stage ingest complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      sourceManifest,
      status: 'ingested',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.ingest, error)
    await agent.failRun(error)
    throw error
  }
}
