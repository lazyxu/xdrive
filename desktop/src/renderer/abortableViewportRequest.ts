let viewportRequestSequence = 0

/**
 * Renderer-to-Main request cancellation. The id is scoped to the IPC sender in
 * Main, so a different window cannot cancel this request. In-flight transport
 * abort is distinct from durable upload/sync/file-operation cancellation.
 */
export async function xDriveDesktopViewportRequest<T>(
  signal: AbortSignal | undefined,
  invoke: (requestID?: string) => Promise<T>,
): Promise<T> {
  if (!signal) return invoke()
  signal.throwIfAborted()
  const requestID = `viewport-${Date.now().toString(36)}-${(++viewportRequestSequence).toString(36)}`
  const onAbort = () => {
    // Send cancellation promptly, including when the request has not yet been
    // registered by Main; Main remembers this id for cancel-before-admission.
    void window.xdriveDesktop.agent.cancelViewportRequest(requestID).catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await invoke(requestID)
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
