import {expect} from '#test/expect'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {probeMedia} from '../../../packages/media/src/ffmpeg.js'
import {runProcess} from '../../../packages/media/src/process.js'
import {verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts.js'
import {createFilmAudioMixProject, createFilmClipPlanProject, createFilmCutProject, createFilmFinalRenderProject, createFilmIngestProject, createFilmOutputNarrationProject, createFilmQualityCheckProject, createFilmStoryIndexProject, createFilmSubtitleProject, createFilmUnderstandingProject, createFilmVoiceoverProject, runFilmRecapProject} from '../../../packages/runtime/src/film-project.js'

describe('film recap project', () => {
  it('creates an ingest checkpoint with source manifest evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)

      const result = await createFilmIngestProject({
        inputPath,
        projectId: 'film-demo',
        workspaceDir: root,
      })
      const manifest = JSON.parse(await readFile(result.artifacts.sourceManifest, 'utf8')) as {
        audioTracks: number
        duration: number
        orientation: string
        sourceHash: string
        sourcePath: string
        width?: number
      }

      expect(result.status).to.equal('ingested')
      expect(manifest.sourcePath).to.equal(inputPath)
      expect(manifest.sourceHash.length).to.equal(64)
      expect(manifest.duration).to.be.greaterThan(0)
      expect(manifest.orientation).to.equal('landscape')
      expect(manifest.width).to.equal(160)
      expect(manifest.audioTracks).to.equal(0)

      const verification = await verifyProjectArtifacts('film-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates source understanding artifacts from an ingest checkpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-understand-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-understand-demo',
        workspaceDir: root,
      })

      const result = await createFilmUnderstandingProject({
        maxScenes: 3,
        projectId: 'film-understand-demo',
        workspaceDir: root,
      })
      const scenes = JSON.parse(await readFile(result.artifacts.scenes, 'utf8')) as {scenes: Array<{id: string}>}
      const frames = JSON.parse(await readFile(result.artifacts.frames, 'utf8')) as {frameCount: number; frames: Array<{path: string}>}
      const fusion = JSON.parse(await readFile(result.artifacts.timelineFusion, 'utf8')) as {items: Array<{sceneId: string; vlmAnalysisIds: string[]}>}

      expect(result.status).to.equal('understood')
      expect(result.scenes).to.equal(1)
      expect(scenes.scenes.map((scene) => scene.id)).to.deep.equal(['scene-001'])
      expect(frames.frameCount).to.equal(1)
      expect((await readFile(frames.frames[0]?.path ?? '')).byteLength).to.be.greaterThan(0)
      expect(fusion.items[0]).to.deep.include({
        sceneId: 'scene-001',
        vlmAnalysisIds: ['vlm-001'],
      })

      const verification = await verifyProjectArtifacts('film-understand-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses ASR and VLM providers for film source understanding when audio is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-provider-understand-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideoWithAudio(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-provider-understand-demo',
        workspaceDir: root,
      })

      const result = await createFilmUnderstandingProject({
        maxScenes: 3,
        projectId: 'film-provider-understand-demo',
        workspaceDir: root,
      })
      const asr = JSON.parse(await readFile(result.artifacts.asrResult, 'utf8')) as {
        segments: Array<{id: string; text: string}>
        text: string
      }
      const silence = JSON.parse(await readFile(result.artifacts.silencePeriods, 'utf8')) as {
        periods: Array<{end: number; reason: string; start: number}>
      }
      const vlm = JSON.parse(await readFile(result.artifacts.vlmAnalysis, 'utf8')) as {
        scenes: Array<{evidence: Array<{ref: string}>; summary: string}>
      }
      const fusion = JSON.parse(await readFile(result.artifacts.timelineFusion, 'utf8')) as {
        items: Array<{asrSegmentIds: string[]; evidence: Array<{type: string}>; vlmAnalysisIds: string[]}>
      }
      const providerCalls = await readFile(join(root, 'projects', 'film-provider-understand-demo', 'artifacts', 'provider-calls.jsonl'), 'utf8')

      expect(result.status).to.equal('understood')
      expect(asr.text).to.contain('Mock transcript')
      expect(asr.segments[0]?.id).to.equal('asr-0001')
      expect(silence.periods[0]).to.deep.include({
        reason: 'placeholder',
        start: 0,
      })
      expect(silence.periods[0]?.end).to.be.greaterThan(0)
      expect(vlm.scenes[0]?.summary).to.equal('Mock visual analysis for scene-001.')
      expect(vlm.scenes[0]?.evidence[0]?.ref).to.contain('film-scene-001.jpg')
      expect(fusion.items[0]?.asrSegmentIds).to.deep.equal([])
      expect(fusion.items[0]?.vlmAnalysisIds).to.deep.equal(['vlm-001'])
      expect(fusion.items[0]?.evidence.map((item) => item.type)).to.include('vlm')
      expect(providerCalls).to.contain('"role":"asr"')
      expect(providerCalls).to.contain('"role":"vlm"')

      const verification = await verifyProjectArtifacts('film-provider-understand-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('builds story index artifacts from timeline fusion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-story-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-story-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-story-demo',
        workspaceDir: root,
      })

      const result = await createFilmStoryIndexProject({
        projectId: 'film-story-demo',
        workspaceDir: root,
      })
      const storyIndex = JSON.parse(await readFile(result.artifacts.storyIndex, 'utf8')) as {beats: Array<{id: string; type: string}>}
      const narrativeBeats = JSON.parse(await readFile(result.artifacts.narrativeBeats, 'utf8')) as {beats: Array<{id: string}>}
      const characterIndex = JSON.parse(await readFile(result.artifacts.characterIndex, 'utf8')) as {characters: unknown[]}

      expect(result.status).to.equal('indexed')
      expect(result.beats).to.equal(1)
      expect(storyIndex.beats[0]).to.deep.include({
        id: 'beat-001',
        type: 'setup',
      })
      expect(narrativeBeats.beats.map((beat) => beat.id)).to.deep.equal(['beat-001'])
      expect(characterIndex.characters).to.deep.equal([])

      const verification = await verifyProjectArtifacts('film-story-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('extracts narrative beat types and characters from ASR/VLM evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-story-evidence-'))
    const inputPath = join(root, 'episode.mp4')
    const projectId = 'film-story-evidence-demo'
    const artifactsDir = join(root, 'projects', projectId, 'artifacts')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId,
        workspaceDir: root,
      })
      await mkdir(artifactsDir, {recursive: true})
      await writeJson(join(artifactsDir, 'asr-result.json'), {
        language: 'zh-CN',
        segments: [
          {
            end: 10,
            id: 'asr-0001',
            start: 0,
            text: '主角发现钥匙，决定 confront 反派。',
            timestampConfidence: 'exact',
          },
          {
            end: 20,
            id: 'asr-0002',
            start: 10,
            text: '反派背叛朋友，真相揭露。',
            timestampConfidence: 'exact',
          },
        ],
        text: '主角发现钥匙，决定 confront 反派。反派背叛朋友，真相揭露。',
        timestampConfidence: 'exact',
        version: 1,
      })
      await writeJson(join(artifactsDir, 'vlm-analysis.json'), {
        scenes: [
          {
            actions: ['confrontation'],
            characters: ['主角', '反派'],
            emotions: ['tension'],
            evidence: [{ref: 'frames/film-scene-001.jpg', text: '人物: 主角, 反派。动作: 对峙。情绪: 紧张。关系: 敌人。线索: 钥匙。', type: 'vlm'}],
            id: 'vlm-001',
            plotClues: ['key object'],
            relationships: ['enemy'],
            sceneId: 'scene-001',
            sourceRange: [0, 10],
            summary: '人物: 主角, 反派。动作: 对峙。情绪: 紧张。关系: 敌人。线索: 钥匙。',
          },
          {
            actions: [],
            characters: ['反派', '朋友'],
            emotions: ['shock'],
            evidence: [{ref: 'frames/film-scene-002.jpg', text: '人物: 反派, 朋友。关系: 背叛。线索: 真相。', type: 'vlm'}],
            id: 'vlm-002',
            plotClues: ['truth reveal'],
            relationships: ['betrayal'],
            sceneId: 'scene-002',
            sourceRange: [10, 20],
            summary: '人物: 反派, 朋友。关系: 背叛。线索: 真相。',
          },
        ],
        source: inputPath,
        version: 1,
      })
      await writeJson(join(artifactsDir, 'timeline-fusion.json'), {
        items: [
          {
            asrSegmentIds: ['asr-0001'],
            evidence: [
              {ref: 'asr-result.json#asr-0001', text: '主角发现钥匙，决定 confront 反派。', type: 'asr'},
              {ref: 'vlm-analysis.json#vlm-001', text: '人物: 主角, 反派。动作: 对峙。', type: 'vlm'},
            ],
            id: 'fusion-001',
            sceneId: 'scene-001',
            silencePeriodIds: [],
            sourceRange: [0, 10],
            summary: '主角发现钥匙并做出决定。',
            vlmAnalysisIds: ['vlm-001'],
          },
          {
            asrSegmentIds: ['asr-0002'],
            evidence: [
              {ref: 'asr-result.json#asr-0002', text: '反派背叛朋友，真相揭露。', type: 'asr'},
              {ref: 'vlm-analysis.json#vlm-002', text: '关系: 背叛。线索: 真相。', type: 'vlm'},
            ],
            id: 'fusion-002',
            sceneId: 'scene-002',
            silencePeriodIds: [],
            sourceRange: [10, 20],
            summary: '反派背叛朋友，真相揭露。',
            vlmAnalysisIds: ['vlm-002'],
          },
        ],
        source: inputPath,
        version: 1,
      })

      const result = await createFilmStoryIndexProject({
        projectId,
        workspaceDir: root,
      })
      const storyIndex = JSON.parse(await readFile(result.artifacts.storyIndex, 'utf8')) as {
        beats: Array<{characters: string[]; summary: string; type: string}>
        characters: Array<{evidence: unknown[]; name: string}>
      }
      const narrativeBeats = JSON.parse(await readFile(result.artifacts.narrativeBeats, 'utf8')) as {beats: Array<{characters: string[]; type: string}>}
      const characterIndex = JSON.parse(await readFile(result.artifacts.characterIndex, 'utf8')) as {characters: Array<{name: string}>}

      expect(result.status).to.equal('indexed')
      expect(result.beats).to.equal(2)
      expect(storyIndex.beats[0]?.type).to.equal('decision')
      expect(storyIndex.beats[1]?.type).to.equal('reversal')
      expect(storyIndex.beats[0]?.characters).to.include.members(['主角', '反派'])
      expect(storyIndex.beats[1]?.characters).to.include.members(['反派', '朋友'])
      expect(storyIndex.beats[1]?.summary).to.contain('真相揭露')
      expect(narrativeBeats.beats.map((beat) => beat.type)).to.deep.equal(['decision', 'reversal'])
      expect(characterIndex.characters.map((character) => character.name)).to.include.members(['主角', '反派', '朋友'])
      expect(storyIndex.characters.find((character) => character.name === '反派')?.evidence.length ?? 0).to.be.greaterThan(0)

      const verification = await verifyProjectArtifacts(projectId, root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('plans clips from story beats with a target duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-plan-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-plan-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-plan-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-plan-demo',
        workspaceDir: root,
      })

      const result = await createFilmClipPlanProject({
        projectId: 'film-plan-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })
      const clipPlan = JSON.parse(await readFile(result.artifacts.clipPlan, 'utf8')) as {
        clips: Array<{beatId?: string; duration: number; sourceRange: [number, number]; start: number}>
        duration: number
      }

      expect(result.status).to.equal('planned')
      expect(result.clips).to.equal(1)
      expect(result.duration).to.equal(0.5)
      expect(clipPlan.duration).to.equal(0.5)
      expect(clipPlan.clips[0]).to.deep.include({
        beatId: 'beat-001',
        duration: 0.5,
        start: 0,
      })
      expect(clipPlan.clips[0]?.sourceRange).to.deep.equal([0, 0.5])

      const verification = await verifyProjectArtifacts('film-plan-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('prioritizes evidence-backed story beats while preserving source chronology', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-plan-priority-'))
    const inputPath = join(root, 'episode.mp4')
    const projectId = 'film-plan-priority-demo'
    const artifactsDir = join(root, 'projects', projectId, 'artifacts')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId,
        workspaceDir: root,
      })
      await mkdir(artifactsDir, {recursive: true})
      await writeJson(join(artifactsDir, 'story-index.json'), {
        beats: [
          {
            characters: ['主角'],
            evidence: [{ref: 'asr-result.json#asr-setup', text: '主角发现线索。', type: 'asr'}],
            id: 'beat-setup',
            sourceRange: [0, 0.2],
            summary: '主角发现线索。',
            type: 'setup',
          },
          {
            characters: [],
            evidence: [],
            id: 'beat-transition',
            sourceRange: [0.2, 0.4],
            summary: '普通过场。',
            type: 'transition',
          },
          {
            characters: ['主角', '反派'],
            evidence: [
              {ref: 'asr-result.json#asr-reversal', text: '反派背叛，真相揭露。', type: 'asr'},
              {ref: 'vlm-analysis.json#vlm-reversal', text: '关系: 背叛。线索: 真相。', type: 'vlm'},
            ],
            id: 'beat-reversal',
            sourceRange: [0.4, 0.7],
            summary: '反派背叛，真相揭露。',
            type: 'reversal',
          },
          {
            characters: ['主角'],
            evidence: [{ref: 'asr-result.json#asr-decision', text: '主角决定反击。', type: 'asr'}],
            id: 'beat-decision',
            sourceRange: [0.7, 1],
            summary: '主角决定反击。',
            type: 'decision',
          },
        ],
        characters: [],
        language: 'zh-CN',
        source: inputPath,
        sourceDuration: 1,
        version: 1,
      })

      const result = await createFilmClipPlanProject({
        projectId,
        targetDurationSeconds: 0.8,
        workspaceDir: root,
      })
      const clipPlan = JSON.parse(await readFile(result.artifacts.clipPlan, 'utf8')) as {
        clips: Array<{beatId?: string; priorityScore?: number; reason?: string; selectionRank?: number; sourceRange: [number, number]; start: number}>
        duration: number
      }

      expect(result.status).to.equal('planned')
      expect(result.clips).to.equal(3)
      expect(clipPlan.duration).to.equal(0.8)
      expect(clipPlan.clips.map((clip) => clip.beatId)).to.deep.equal(['beat-setup', 'beat-reversal', 'beat-decision'])
      expect(clipPlan.clips.map((clip) => clip.sourceRange)).to.deep.equal([[0, 0.2], [0.4, 0.7], [0.7, 1]])
      expect(clipPlan.clips.map((clip) => clip.start)).to.deep.equal([0, 0.2, 0.5])
      expect(clipPlan.clips.map((clip) => clip.selectionRank)).to.deep.equal([3, 1, 2])
      expect(clipPlan.clips[1]?.priorityScore ?? 0).to.be.greaterThan(clipPlan.clips[2]?.priorityScore ?? 0)
      expect(clipPlan.clips[2]?.priorityScore ?? 0).to.be.greaterThan(clipPlan.clips[0]?.priorityScore ?? 0)
      expect(clipPlan.clips[1]?.reason).to.contain('score')

      const verification = await verifyProjectArtifacts(projectId, root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses ASR semantic subsegments when a full beat does not fit the target duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-plan-semantic-'))
    const inputPath = join(root, 'episode.mp4')
    const projectId = 'film-plan-semantic-demo'
    const artifactsDir = join(root, 'projects', projectId, 'artifacts')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId,
        workspaceDir: root,
      })
      await mkdir(artifactsDir, {recursive: true})
      await writeJson(join(artifactsDir, 'asr-result.json'), {
        language: 'zh-CN',
        segments: [
          {
            end: 0.5,
            id: 'asr-0001',
            start: 0,
            text: '开场交代完整背景。',
            timestampConfidence: 'exact',
          },
          {
            end: 0.8,
            id: 'asr-0002',
            start: 0.5,
            text: '前半段解决问题。',
            timestampConfidence: 'exact',
          },
          {
            end: 1,
            id: 'asr-0003',
            start: 0.8,
            text: '后半段不能出现在解说里。',
            timestampConfidence: 'exact',
          },
        ],
        text: '开场交代完整背景。前半段解决问题。后半段不能出现在解说里。',
        timestampConfidence: 'exact',
        version: 1,
      })
      await writeJson(join(artifactsDir, 'story-index.json'), {
        beats: [
          {
            characters: ['主角'],
            evidence: [{ref: 'asr-result.json#asr-0001', text: '开场交代完整背景。', type: 'asr'}],
            id: 'beat-opening',
            sourceRange: [0, 0.5],
            summary: '开场交代完整背景，真相揭露。',
            type: 'reversal',
          },
          {
            characters: ['主角'],
            evidence: [
              {ref: 'asr-result.json#asr-0002', text: '前半段解决问题。', type: 'asr'},
              {ref: 'asr-result.json#asr-0003', text: '后半段不能出现在解说里。', type: 'asr'},
            ],
            id: 'beat-climax',
            sourceRange: [0.5, 1],
            summary: '前半段解决问题。后半段不能出现在解说里。',
            type: 'climax',
          },
        ],
        characters: [],
        language: 'zh-CN',
        source: inputPath,
        sourceDuration: 1,
        version: 1,
      })

      const result = await createFilmClipPlanProject({
        projectId,
        targetDurationSeconds: 0.8,
        workspaceDir: root,
      })
      const clipPlan = JSON.parse(await readFile(result.artifacts.clipPlan, 'utf8')) as {
        clips: Array<{id: string; reason?: string; sourceRange: [number, number]; start: number}>
        duration: number
      }

      expect(result.status).to.equal('planned')
      expect(result.clips).to.equal(2)
      expect(clipPlan.duration).to.equal(0.8)
      expect(clipPlan.clips.map((clip) => clip.sourceRange)).to.deep.equal([[0, 0.5], [0.5, 0.8]])
      expect(clipPlan.clips[1]?.reason).to.contain('ASR moment asr-0002')

      await writeJson(join(artifactsDir, 'clip-plan-validated.json'), clipPlan)
      await writeJson(join(artifactsDir, 'output-timeline-map.json'), {
        clips: clipPlan.clips.map((clip) => ({
          clipId: clip.id,
          outputEnd: clip.start + (clip.sourceRange[1] - clip.sourceRange[0]),
          outputStart: clip.start,
          sourceEnd: clip.sourceRange[1],
          sourceStart: clip.sourceRange[0],
        })),
        outputDuration: clipPlan.duration,
        source: inputPath,
        version: 1,
      })

      const narrationResult = await createFilmOutputNarrationProject({
        projectId,
        workspaceDir: root,
      })
      const outputNarration = JSON.parse(await readFile(narrationResult.artifacts.outputNarration, 'utf8')) as {
        segments: Array<{evidence: string[]; text: string}>
      }

      expect(outputNarration.segments[1]?.text).to.contain('前半段解决问题')
      expect(outputNarration.segments[1]?.text).not.include('后半段不能出现在解说里')
      expect(outputNarration.segments[1]?.evidence).to.include('asr-result.json#asr-0002')
      expect(outputNarration.segments[1]?.evidence).not.include('asr-result.json#asr-0003')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('renders a cut-first edited source and output timeline map', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-cut-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-cut-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-cut-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-cut-demo',
        workspaceDir: root,
      })
      await createFilmClipPlanProject({
        projectId: 'film-cut-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })

      const result = await createFilmCutProject({
        projectId: 'film-cut-demo',
        workspaceDir: root,
      })
      const timelineMap = JSON.parse(await readFile(result.artifacts.outputTimelineMap, 'utf8')) as {
        clips: Array<{clipId: string; outputEnd: number; outputStart: number; sourceEnd: number; sourceStart: number}>
        outputDuration: number
      }

      expect(result.status).to.equal('cut')
      expect((await readFile(result.outputPath)).byteLength).to.be.greaterThan(0)
      expect(timelineMap.outputDuration).to.equal(0.5)
      expect(timelineMap.clips[0]).to.deep.equal({
        clipId: 'clip-001',
        outputEnd: 0.5,
        outputStart: 0,
        sourceEnd: 0.5,
        sourceStart: 0,
      })

      const verification = await verifyProjectArtifacts('film-cut-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes narration against the edited output timeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-narrate-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-narrate-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-narrate-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-narrate-demo',
        workspaceDir: root,
      })
      await createFilmClipPlanProject({
        projectId: 'film-narrate-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })
      await createFilmCutProject({
        projectId: 'film-narrate-demo',
        workspaceDir: root,
      })

      const result = await createFilmOutputNarrationProject({
        projectId: 'film-narrate-demo',
        workspaceDir: root,
      })
      const outputNarration = JSON.parse(await readFile(result.artifacts.outputNarration, 'utf8')) as {
        segments: Array<{end: number; evidence: string[]; start: number; text: string}>
        timeline: string
      }
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {
        segments: Array<{duration: number; start: number; text: string}>
      }

      expect(result.status).to.equal('narrated')
      expect(result.segments).to.equal(1)
      expect(outputNarration.timeline).to.equal('output')
      expect(outputNarration.segments[0]).to.deep.include({
        end: 0.5,
        evidence: ['beat-001', 'clip-001'],
        start: 0,
      })
      expect(outputNarration.segments[0]?.text).to.equal('这一段保留开场关键画面，交代故事背景。')
      expect(outputNarration.segments[0]?.text).not.include('第 1 段')
      expect(outputNarration.segments[0]?.text).not.include('Mock visual analysis')
      expect(narration.segments[0]).to.deep.include({
        duration: 0.5,
        start: 0,
      })

      const verification = await verifyProjectArtifacts('film-narrate-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('synthesizes voiceover segments from film narration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-voice-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })
      await createFilmClipPlanProject({
        projectId: 'film-voice-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })
      await createFilmCutProject({
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })
      await createFilmOutputNarrationProject({
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })

      const result = await createFilmVoiceoverProject({
        projectId: 'film-voice-demo',
        workspaceDir: root,
      })
      const ttsSegments = JSON.parse(await readFile(result.artifacts.ttsSegments, 'utf8')) as Array<{duration: number; narrationId: string; path: string}>

      expect(result.status).to.equal('voiced')
      expect(result.segments).to.equal(1)
      expect(ttsSegments[0]).to.deep.include({
        duration: 0.5,
        narrationId: 'output-narration-001',
      })
      expect(ttsSegments[0]?.path).to.equal('audio/tts/0001-output-narration-001.wav')
      expect((await readFile(join(root, 'projects', 'film-voice-demo', ttsSegments[0]?.path ?? ''))).byteLength).to.be.greaterThan(44)

      const verification = await verifyProjectArtifacts('film-voice-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('mixes voiceover audio against the edited output timeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-mix-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideoWithAudio(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      await createFilmClipPlanProject({
        projectId: 'film-mix-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })
      await createFilmCutProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      await createFilmOutputNarrationProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      await createFilmVoiceoverProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })

      const result = await createFilmAudioMixProject({
        projectId: 'film-mix-demo',
        workspaceDir: root,
      })
      const audioMix = JSON.parse(await readFile(result.artifacts.audioMix, 'utf8')) as {
        ducking?: {ratio: number; threshold: number}
        duration: number
        mode: string
        outputPath: string
        sourceAudioRetained: boolean
        sourcePath: string
        sourceVolume: number
        voiceoverVolume: number
        voiceoverSegments: Array<{delayMs: number; duration: number; narrationId: string; resolvedPath: string; start: number}>
      }
      const renderedCutProbe = await probeMedia(join(root, 'projects', 'film-mix-demo', 'renders', 'edited_source.mp4'))

      expect(result.status).to.equal('mixed')
      expect(audioMix.duration).to.equal(0.5)
      expect(audioMix.mode).to.equal('source-ducked')
      expect(audioMix.outputPath).to.equal('audio/audio_mix.wav')
      expect(audioMix.sourceAudioRetained).to.equal(true)
      expect(audioMix.sourcePath).to.equal('renders/edited_source.mp4')
      expect(audioMix.sourceVolume).to.equal(0.35)
      expect(audioMix.voiceoverVolume).to.equal(1)
      expect(audioMix.ducking).to.deep.include({
        ratio: 8,
        threshold: 0.03,
      })
      expect(audioMix.voiceoverSegments[0]).to.deep.include({
        delayMs: 0,
        duration: 0.5,
        narrationId: 'output-narration-001',
        resolvedPath: 'audio/tts/0001-output-narration-001.wav',
        start: 0,
      })
      expect((await readFile(result.outputPath)).byteLength).to.be.greaterThan(44)
      expect(renderedCutProbe.streams.some((stream) => stream.type === 'audio')).to.equal(true)

      const verification = await verifyProjectArtifacts('film-mix-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('renders a final subtitled recap and writes quality diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-film-final-'))
    const inputPath = join(root, 'episode.mp4')

    try {
      await createSampleVideo(inputPath)
      await createFilmIngestProject({
        inputPath,
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmUnderstandingProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmStoryIndexProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmClipPlanProject({
        projectId: 'film-final-demo',
        targetDurationSeconds: 0.5,
        workspaceDir: root,
      })
      await createFilmCutProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmOutputNarrationProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmVoiceoverProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      await createFilmAudioMixProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })

      const subtitle = await createFilmSubtitleProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      const subtitleOutput = JSON.parse(await readFile(subtitle.artifacts.subtitles, 'utf8')) as {cues: number; format: string; path: string}

      expect(subtitle.status).to.equal('subtitled')
      expect(subtitleOutput).to.deep.include({
        cues: 1,
        format: 'srt',
        path: 'renders/subtitles.srt',
      })
      expect(await readFile(subtitle.outputPath, 'utf8')).to.contain('00:00:00,000 --> 00:00:00,500')

      const render = await createFilmFinalRenderProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      const renderOutput = JSON.parse(await readFile(render.artifactPath, 'utf8')) as {
        audioInputs: number
        audioMixPath: string
        outputPath: string
        outputQuality: {audioStreams: number; videoStreams: number}
        renderer: string
        subtitlePath: string
      }

      expect(render.status).to.equal('rendered')
      expect(render.renderer).to.equal('ffmpeg')
      expect((await readFile(render.outputPath)).byteLength).to.be.greaterThan(0)
      expect(renderOutput).to.deep.include({
        audioInputs: 1,
        audioMixPath: 'audio/audio_mix.wav',
        outputPath: 'renders/final.mp4',
        renderer: 'ffmpeg',
        subtitlePath: 'renders/subtitles.srt',
      })
      expect(renderOutput.outputQuality.videoStreams).to.equal(1)
      expect(renderOutput.outputQuality.audioStreams).to.equal(1)

      const quality = await createFilmQualityCheckProject({
        projectId: 'film-final-demo',
        workspaceDir: root,
      })
      const qualityReport = JSON.parse(await readFile(quality.artifactPath, 'utf8')) as {
        narrationSegments: number
        summary: {errors: number}
        ttsSegments: number
      }

      expect(quality.status).to.equal('checked')
      expect(qualityReport.narrationSegments).to.equal(1)
      expect(qualityReport.ttsSegments).to.equal(1)
      expect(qualityReport.summary.errors).to.equal(0)
      const jobState = JSON.parse(await readFile(join(root, 'projects', 'film-final-demo', 'job-state.json'), 'utf8')) as {pipeline?: string; status: string}
      const pipelineEvents = await readFile(join(root, 'projects', 'film-final-demo', 'artifacts', 'pipeline-events.jsonl'), 'utf8')

      expect(jobState).to.include({
        pipeline: 'film',
        status: 'completed',
      })
      expect(pipelineEvents).to.contain('"stage":"quality-check"')

      const resumed = await runFilmRecapProject({
        fromStage: 'quality-check',
        inputPath,
        projectId: 'film-final-demo',
        workspaceDir: root,
      })

      expect(resumed).to.include({
        fromStage: 'quality-check',
        pipeline: 'film',
        status: 'completed',
      })
      expect(resumed.completedStages).to.deep.equal(['quality-check'])

      const verification = await verifyProjectArtifacts('film-final-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createSampleVideo(inputPath: string): Promise<void> {
  const result = await runProcess([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=10',
    '-t',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'mpeg4',
    inputPath,
  ])

  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
}

async function createSampleVideoWithAudio(inputPath: string): Promise<void> {
  const result = await runProcess([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '1',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    inputPath,
  ])

  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
