import type {PipelineEvent} from '@video-agent/core'

export class PipelineEventBus {
  private readonly listeners = new Set<(event: PipelineEvent) => void>()

  emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  onEvent(listener: (event: PipelineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
