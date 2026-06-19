import {runProcess} from '@video-agent/media'
import {access} from 'node:fs/promises'

export interface CjkSubtitleFont {
  family: string
  path: string
}

export type CjkSubtitleFontMatcher = (family: string) => Promise<string | undefined>

export const CJK_SUBTITLE_FONT_FAMILIES = [
  'Noto Sans CJK SC',
  'Noto Sans SC',
  'Source Han Sans CN',
  'Source Han Sans SC',
  'WenQuanYi Zen Hei',
  'Microsoft YaHei',
  'SimHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Songti SC',
  'Kaiti SC',
]

export async function findCjkSubtitleFont(matchFont: CjkSubtitleFontMatcher = matchSystemFontPath): Promise<CjkSubtitleFont | undefined> {
  const matches = await Promise.all(CJK_SUBTITLE_FONT_FAMILIES.map(async (family) => ({
    family,
    path: await matchFont(family),
  })))
  const match = matches.find((font): font is CjkSubtitleFont => font.path !== undefined && isReliableCjkSubtitleFontPath(font.path))

  return match
}

export async function findCjkSubtitleFontPath(matchFont?: CjkSubtitleFontMatcher): Promise<string | undefined> {
  return (await findCjkSubtitleFont(matchFont))?.path
}

export function isReliableCjkSubtitleFontPath(path: string): boolean {
  return /(Noto(?:\s|-|_)*Sans(?:\s|-|_)*(?:CJK|SC)|NotoSans(?:CJK|SC)|Source(?:\s|-|_)*Han|SourceHan|WenQuanYi|Microsoft(?:\s|-|_)*YaHei|msyh|SimHei|PingFang|Hiragino|Songti|Kaiti)/iu.test(path)
}

async function matchSystemFontPath(family: string): Promise<string | undefined> {
  try {
    const result = await runProcess(['fc-match', '-f', '%{file}', family])

    if (result.code !== 0) {
      return undefined
    }

    const path = result.stdout.trim()

    if (path === '') {
      return undefined
    }

    await access(path)

    return path
  } catch {
    return undefined
  }
}
