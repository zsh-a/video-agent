import {mkdir, writeFile} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'

interface GoldenCaseManifest {
  cases: GoldenCase[]
}

interface GoldenCase {
  fixturePolicy?: string
  id: string
  input: {
    kind: 'audio' | 'markdown'
    path: string
  }
  source: {
    downloadUrl: string
  }
}

const root = dirname(new URL(import.meta.url).pathname)
const manifestPath = join(root, 'cases.json')
const manifest = await Bun.file(manifestPath).json() as GoldenCaseManifest

await Promise.all(manifest.cases.map(async (goldenCase) => {
  if (goldenCase.fixturePolicy === 'manual-excerpt') {
    console.log(`skip ${goldenCase.id}: manual excerpt required`)
    return
  }

  const outputPath = resolve(root, goldenCase.input.path)
  const outputDir = dirname(outputPath)
  const casePath = join(outputDir, 'case.json')

  await mkdir(outputDir, {recursive: true})

  const response = await fetch(goldenCase.source.downloadUrl)

  if (!response.ok) {
    throw new Error(`Failed to download ${goldenCase.id}: HTTP ${response.status} ${response.statusText}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  await writeFile(outputPath, bytes)
  await writeFile(casePath, `${JSON.stringify(goldenCase, null, 2)}\n`)
  console.log(`wrote ${goldenCase.id}: ${basename(outputPath)} (${bytes.length} bytes)`)
}))
