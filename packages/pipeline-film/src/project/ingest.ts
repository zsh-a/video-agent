import {SourceManifestSchema} from '@video-agent/ir'
import {probeMedia} from '@video-agent/media'
import {resolve} from 'node:path'

import {assertFileExists, createProjectWorkspace, refreshArtifactManifest} from '@video-agent/runtime'
import type {CreateFilmIngestProjectOptions, CreateFilmIngestProjectResult} from './types.js'
import {createSourceManifest} from '../planning/source.js'
import {completeFilmStage, createFilmJobStore, failFilmStage, startFilmStage} from '../shared/stage-runtime.js'
import {hashFile} from '../shared/utils.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES} from '../pipeline.js'

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
  await startFilmStage(jobStore, workspace, 'ingest')

  try {
    const [mediaInfo, sourceHash] = await Promise.all([
      probeMedia(inputPath),
      hashFile(inputPath),
    ])
    const sourceManifest = SourceManifestSchema.parse(createSourceManifest(mediaInfo, sourceHash))
    const artifacts = {
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      sourceManifest: await workspace.store.writeJson('source-manifest.json', sourceManifest),
    }

    await completeFilmStage(jobStore, workspace, 'ingest')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      sourceManifest,
      status: 'ingested',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'ingest', error)
    throw error
  }
}
