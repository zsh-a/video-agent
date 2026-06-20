import {expect} from '#test/expect'

import type {ASRResult, ClipPlan, OutputTimelineMap, RecapScript, StoryIndex} from '../../../packages/ir/src/index.js'

import {createOutputNarration} from '../../../packages/pipeline-film/src/planning/narration.js'

const clipPlan: ClipPlan = {
  clips: [{
    beatId: 'beat-001',
    duration: 2,
    id: 'clip-001',
    sceneId: 'beat-001',
    scriptSegmentId: 'recap-script-001',
    selectionReason: 'script-driven',
    selectionRank: 1,
    source: '/tmp/source.mp4',
    sourceRange: [0, 2],
    start: 0,
  }],
  duration: 2,
  source: '/tmp/source.mp4',
  sourceDuration: 4,
  version: 1,
}

const outputTimelineMap: OutputTimelineMap = {
  clips: [{
    clipId: 'clip-001',
    outputEnd: 2,
    outputStart: 0,
    sourceEnd: 2,
    sourceStart: 0,
  }],
  outputDuration: 2,
  source: '/tmp/source.mp4',
  version: 1,
}

const storyIndex: StoryIndex = {
  beats: [{
    characters: ['主角'],
    evidence: [{ref: 'asr-result.json#asr-001', text: '主角发现证据。', type: 'asr'}],
    id: 'beat-001',
    sourceRange: [0, 2],
    summary: '主角发现证据。',
    type: 'setup',
  }],
  characters: [],
  language: 'zh-CN',
  source: '/tmp/source.mp4',
  sourceDuration: 4,
  version: 1,
}

function recapScript(narrationText = '主角发现证据，故事由此展开。', overlapsSpeech = true): RecapScript {
  return {
    hook: '故事从证据开始。',
    language: 'zh-CN',
    outro: '证据改变了局面。',
    segments: [{
      clipSelectionReason: '选择主角发现证据的原始片段，因为它直接支撑旁白中的转折。',
      emotionalTone: 'setup',
      id: 'recap-script-001',
      narrationText,
      overlapsSpeech,
      pauseAfterMs: 430,
      sourceRange: [0, 2],
      suggestedDuration: 2,
      targetBeatIds: ['beat-001'],
      visualGuidance: '使用主角发现证据的画面。',
    }],
    totalEstimatedDuration: 2,
    version: 1,
  }
}

const asrResult: ASRResult = {
  language: 'zh-CN',
  segments: [{
    end: 1.8,
    id: 'asr-001',
    start: 0.2,
    text: '主角发现证据。',
    timestampConfidence: 'exact',
  }],
  text: '主角发现证据。',
  timestampConfidence: 'exact',
  version: 1,
}

describe('film output narration planning', () => {
  it('preserves LLM-authored overlapsSpeech while attaching matching ASR evidence', () => {
    const outputNarration = createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, 'zh-CN', recapScript())

    expect(outputNarration.segments[0]?.overlapsSpeech).to.equal(true)
    expect(outputNarration.segments[0]?.evidence).to.include('asr-result.json#asr-001')
    expect(outputNarration.segments[0]?.pauseAfterMs).to.equal(430)
  })

  it('does not infer overlapsSpeech from ASR overlap when the LLM script says false', () => {
    const outputNarration = createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, 'zh-CN', recapScript('主角发现证据，故事由此展开。', false))

    expect(outputNarration.segments[0]?.overlapsSpeech).to.equal(false)
    expect(outputNarration.segments[0]?.evidence).to.include('asr-result.json#asr-001')
  })

  it('preserves LLM-authored narration text instead of rejecting it with CJK heuristics', () => {
    const outputNarration = createOutputNarration(
      clipPlan,
      outputTimelineMap,
      storyIndex,
      undefined,
      'zh-CN',
      recapScript('The protagonist finds evidence and the story begins.'),
    )

    expect(outputNarration.segments[0]?.text).to.equal('The protagonist finds evidence and the story begins.')
  })

  it('rejects empty narration text instead of synthesizing a fallback', () => {
    expect(() => createOutputNarration(
      clipPlan,
      outputTimelineMap,
      storyIndex,
      undefined,
      'zh-CN',
      recapScript('   '),
    )).to.throw('no runtime narration text fallback is allowed')
  })

  it('rejects segment-label narration instead of stripping it locally', () => {
    expect(() => createOutputNarration(
      clipPlan,
      outputTimelineMap,
      storyIndex,
      undefined,
      'zh-CN',
      recapScript('第 1 段：主角发现证据，故事由此展开。'),
    )).to.throw('no runtime narration label cleanup is allowed')
  })

  it('rejects leading or trailing narration whitespace instead of trimming it locally', () => {
    expect(() => createOutputNarration(
      clipPlan,
      outputTimelineMap,
      storyIndex,
      undefined,
      'zh-CN',
      recapScript(' 主角发现证据，故事由此展开。'),
    )).to.throw('no runtime narration whitespace cleanup is allowed')
  })

  it('rejects layout narration whitespace instead of collapsing it locally', () => {
    expect(() => createOutputNarration(
      clipPlan,
      outputTimelineMap,
      storyIndex,
      undefined,
      'zh-CN',
      recapScript('主角发现证据，\n故事由此展开。'),
    )).to.throw('no runtime narration whitespace cleanup is allowed')
  })
})
