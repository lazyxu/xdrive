import { xDriveCreateWebDownloadProgressReporter } from './downloadSink'

export function xDriveTransferAbortError() {
  return new DOMException('传输跟踪已结束。', 'AbortError')
}

/** Missing or denied AbortSignal state never grants permission to retry. */
function xDriveTransferCancelled(signal?: AbortSignal): boolean {
  if (!signal) return false
  try { return signal.aborted !== false }
  catch { return true }
}

export function xDriveWaitForTransferPoll(signal: AbortSignal, milliseconds = 500) {
  return new Promise<void>((resolve, reject) => {
    if (xDriveTransferCancelled(signal)) { reject(xDriveTransferAbortError()); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempted = false
    let settled = false
    const cleanup = () => {
      if (timer !== null) { clearTimeout(timer); timer = null }
      if (!attempted) return
      attempted = false
      try { signal.removeEventListener('abort', abort) }
      catch { /* A denied optional cleanup must not hide the settled result. */ }
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(xDriveTransferAbortError())
    }
    try {
      attempted = true
      signal.addEventListener('abort', abort, { once: true })
      // Close the check/subscription race before scheduling any poll.
      if (settled || xDriveTransferCancelled(signal)) { abort(); cleanup(); return }
      timer = setTimeout(() => {
        if (xDriveTransferCancelled(signal)) { abort(); return }
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }, milliseconds)
    } catch { abort(); cleanup() }
  })
}

// fetch does not expose request-body progress. XHR preserves the raw chunk
// request while reporting bytes during the upload, before its response arrives.
export function xDriveUploadBytes(
  url: string,
  input: {
    headers: Record<string, string>
    body: ArrayBuffer | Blob
    signal?: AbortSignal
    onProgress: (loaded: number) => void
  },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (xDriveTransferCancelled(input.signal)) { reject(xDriveTransferAbortError()); return }
    const xhr = new XMLHttpRequest()
    const progress = xDriveCreateWebDownloadProgressReporter(input.onProgress)
    let listenerAttempted = false
    let cancelled = false
    const cleanup = () => {
      if (!listenerAttempted) return
      listenerAttempted = false
      try { input.signal?.removeEventListener('abort', abort) }
      catch { /* Optional listener cleanup must not strand the XHR Promise. */ }
    }
    const abort = () => {
      if (cancelled) return
      cancelled = true
      try { xhr.abort() } catch { /* Logical cancellation remains authoritative. */ }
      cleanup()
      reject(xDriveTransferAbortError())
    }
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(input.headers)) xhr.setRequestHeader(name, value)
    const bodySize = input.body instanceof Blob ? input.body.size : input.body.byteLength
    xhr.upload.onprogress = (event) => {
      try { progress.progress(Math.min(bodySize, Math.max(0, event.loaded))) }
      catch { /* Telemetry cannot strand a real upload. */ }
    }
    // A progress observer may have been disposed while a browser-owned XHR
    // terminal event was still pending. Its exception must not strand the
    // transfer Promise or override the actual HTTP/network outcome.
    const flushProgress = () => { try { progress.flush() } catch { /* optional telemetry */ } }
    xhr.onload = () => {
      cleanup()
      flushProgress()
      if (cancelled || xDriveTransferCancelled(input.signal)) { reject(xDriveTransferAbortError()); return }
      // A browser may deliver an anomalous onload without an HTTP status.
      // Response(status: 0) would throw inside an async event handler and leave
      // the upload pending forever instead of showing a retryable failure.
      if (xhr.status === 0) { reject(new TypeError('上传连接失败。')); return }
      try {
        resolve(new Response(xhr.responseText || null, { status: xhr.status, statusText: xhr.statusText }))
      } catch (error) {
        // Malformed browser/proxy terminal responses must settle as failures.
        reject(error)
      }
    }
    xhr.onerror = () => {
      cleanup()
      flushProgress()
      reject(new TypeError('上传连接失败。'))
    }
    xhr.ontimeout = () => {
      cleanup()
      flushProgress()
      reject(new TypeError('上传连接超时。'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(xDriveTransferAbortError())
    }
    try {
      if (input.signal) {
        listenerAttempted = true
        input.signal.addEventListener('abort', abort, { once: true })
        // The signal may cancel synchronously during listener admission.
        if (cancelled || xDriveTransferCancelled(input.signal)) {
          abort()
          cleanup()
          return
        }
      }
    } catch {
      cleanup()
      reject(xDriveTransferAbortError())
      return
    }
    try {
      xhr.send(input.body)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
