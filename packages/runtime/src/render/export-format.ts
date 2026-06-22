export const EXPORT_FORMATS = ['video', 'bundle'] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function isExportFormat(format: string): format is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(format)
}
