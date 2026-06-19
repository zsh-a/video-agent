import type {TuiCommandSuggestion, TuiSnapshot} from '../model.js'

import {createVideoAgentGuidedActions} from '@video-agent/runtime'

export function createTuiCommandSuggestions(snapshot: TuiSnapshot, options: {commandPrefix: string}): TuiCommandSuggestion[] {
  return createVideoAgentGuidedActions({
    artifacts: snapshot.artifacts,
    commandPrefix: options.commandPrefix,
    status: snapshot.selected,
    workspaceDir: snapshot.workspaceDir,
  })
}

export function formatTuiCommands(commands: TuiCommandSuggestion[]): string[] {
  if (commands.length === 0) {
    return ['  none']
  }

  return commands.map((item) => `  ${item.label.padEnd(24)} ${item.command}`)
}

export function formatTuiCommandSelector(commands: TuiCommandSuggestion[]): string[] {
  if (commands.length === 0) {
    return ['Guided Actions', '  none']
  }

  return [
    'Guided Actions',
    ...commands.flatMap((item, index) => {
      const category = item.category === undefined ? '' : ` [${item.category}]`
      const description = item.description === undefined ? [] : [`      ${item.description}`]

      return [
        `  ${String(index + 1).padStart(2, ' ')}. ${item.label}${category}`,
        ...description,
        `      ${item.command}`,
      ]
    }),
  ]
}

export function resolveTuiCommandSelection(commands: TuiCommandSuggestion[], choice: string): TuiCommandSuggestion | undefined {
  const normalized = choice.trim()

  if (normalized === '') {
    return undefined
  }

  const selectedIndex = Number.parseInt(normalized, 10)

  if (String(selectedIndex) === normalized && selectedIndex >= 1 && selectedIndex <= commands.length) {
    return commands[selectedIndex - 1]
  }

  return commands.find((item) => item.id === normalized || item.label.toLowerCase() === normalized.toLowerCase())
}
