export type DesktopLoginIntent = { signal: AbortSignal; current: () => boolean }
export class DesktopLoginIntents {
  private controller: AbortController | null = null
  private generation = 0
  private mutations: Promise<unknown> = Promise.resolve()
  begin(): DesktopLoginIntent {
    this.cancel()
    const controller = new AbortController(); this.controller = controller
    const generation = this.generation
    return { signal: controller.signal, current: () => generation === this.generation && !controller.signal.aborted }
  }
  cancel(): void { this.controller?.abort(); this.controller = null; this.generation++ }
  run<T>(intent: DesktopLoginIntent, action: () => Promise<T>): Promise<T> {
    const work = this.mutations.catch(() => {}).then(async () => {
      if (!intent.current()) throw new Error('登录操作已取消。')
      return action()
    })
    this.mutations = work
    return work
  }
  logout<T>(action: () => Promise<T>): Promise<T> {
    this.cancel()
    // If credentials already left, do not replay or assume physical cancellation.
    // Run revocation AFTER that one in-flight login reaches an outcome.
    const work = this.mutations.catch(() => {}).then(action)
    this.mutations = work
    return work
  }
}
