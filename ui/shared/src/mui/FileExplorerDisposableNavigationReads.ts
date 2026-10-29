/**
 * Per-mounted-FileExplorer, disposable Node metadata GET scope.
 * Never send its signal to uploads, downloads, sync, backup, mutations or
 * another window. Controller and intent are renderer memory only.
 */
export function xDriveCreateFileExplorerDisposableNavigationReads() {
  let active: { intentID: number; controller: AbortController } | null = null
  return {
    signalFor(intentID: number): AbortSignal {
      if (active?.intentID === intentID && !active.controller.signal.aborted) {
        return active.controller.signal
      }
      active?.controller.abort()
      const controller = new AbortController()
      active = { intentID, controller }
      return controller.signal
    },
    cancel(): void {
      active?.controller.abort()
      active = null
    },
  }
}
