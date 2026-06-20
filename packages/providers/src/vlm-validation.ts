import type {SceneFrameBatch, VLMScene} from './contracts.js'
import type {ProviderValidationIssue} from './errors.js'

import {ProviderResponseValidationError} from './errors.js'

export function validateVlmScenesForBatches(scenes: VLMScene[], batches: SceneFrameBatch[]): VLMScene[] {
  const issues: ProviderValidationIssue[] = []

  if (scenes.length !== batches.length) {
    issues.push({
      code: 'vlm_scene_count_mismatch',
      message: `VLM provider returned ${scenes.length} scene(s), expected ${batches.length}.`,
      path: [],
    })
  }

  const pairCount = Math.min(scenes.length, batches.length)

  for (let index = 0; index < pairCount; index += 1) {
    const scene = scenes[index]
    const batch = batches[index]

    if (scene === undefined || batch === undefined) {
      continue
    }

    if (scene.sceneId !== batch.sceneId) {
      issues.push({
        code: 'vlm_scene_id_mismatch',
        message: `VLM provider returned sceneId ${JSON.stringify(scene.sceneId)} at index ${index}, expected ${JSON.stringify(batch.sceneId)}.`,
        path: [String(index), 'sceneId'],
      })
    }

    const frameSet = new Set(batch.frames)

    scene.evidence.forEach((ref, evidenceIndex) => {
      if (!frameSet.has(ref)) {
        issues.push({
          code: 'vlm_evidence_frame_mismatch',
          message: `VLM provider scene "${scene.sceneId}" evidence ref ${JSON.stringify(ref)} was not present in that scene frame batch; no VLM evidence remapping fallback is allowed.`,
          path: [String(index), 'evidence', String(evidenceIndex)],
        })
      }
    })
  }

  if (issues.length > 0) {
    throw new ProviderResponseValidationError('vlm', 'VLM provider returned scene data that does not match the requested frame batches.', issues)
  }

  return scenes
}
