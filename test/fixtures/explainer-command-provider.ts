const payload = JSON.parse(await Bun.stdin.text()) as {
  input?: unknown
  kind?: string
  segments?: Array<{duration?: number; id?: string; text?: string}>
}

switch (payload.kind) {
  case 'asr':
    console.log(JSON.stringify({
      language: 'zh-CN',
      segments: [
        {
          end: 18,
          start: 0,
          text: '第一部分介绍开源下载器，说明复制链接、选择画质、保存下载记录这三个核心步骤。',
        },
        {
          end: 36,
          start: 18,
          text: '第二部分介绍音乐播放器，通过插件聚合不同音乐源，并支持歌词、专辑和离线下载。',
        },
        {
          end: 54,
          start: 36,
          text: '第三部分介绍直播聚合工具，重点说明多平台切换、弹幕显示和简洁观看体验。',
        },
        {
          end: 70,
          start: 54,
          text: '第四部分介绍清理工具和闪光灯工具，强调自动清理、计划任务、SOS 和摩斯电码玩法。',
        },
      ],
      text: [
        '第一部分介绍开源下载器，说明复制链接、选择画质、保存下载记录这三个核心步骤。',
        '第二部分介绍音乐播放器，通过插件聚合不同音乐源，并支持歌词、专辑和离线下载。',
        '第三部分介绍直播聚合工具，重点说明多平台切换、弹幕显示和简洁观看体验。',
        '第四部分介绍清理工具和闪光灯工具，强调自动清理、计划任务、SOS 和摩斯电码玩法。',
      ].join('\n'),
      timestampConfidence: 'exact',
    }))
    break

  case 'vlm': {
    const scenes = Array.isArray(payload.input) ? payload.input : []

    console.log(JSON.stringify(scenes.map((scene, index) => ({
      description: [
        '下载器界面与链接输入框。',
        '音乐播放器和插件管理界面。',
        '直播平台列表和弹幕观看界面。',
        '系统清理和闪光灯工具界面。',
      ][index] ?? `讲解画面 ${index + 1}`,
      evidence: Array.isArray(scene.frames) ? scene.frames : [],
      sceneId: typeof scene.sceneId === 'string' ? scene.sceneId : `scene-${index + 1}`,
    }))))
    break
  }

  case 'tts':
    console.log(JSON.stringify((payload.segments ?? []).map((segment, index) => ({
      duration: segment.duration ?? 1,
      narrationId: segment.id ?? `narration-${index + 1}`,
      path: `tts/${segment.id ?? `narration-${index + 1}`}.wav`,
    }))))
    break

  default:
    throw new Error(`Unsupported provider kind: ${String(payload.kind)}`)
}
