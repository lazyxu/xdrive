import { xDriveCreateWebDownloadProgressReporter } from './downloadSink'

export function xDriveTransferAbortError() {
  return new DOMException('传输跟踪已结束。', 'AbortError')
}

export function xDriveWaitForTransferPoll(signal: AbortSignal, milliseconds = 500) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(xDriveTransferAbortError()); return }
    const abort = () => {
      clearTimeout(timer)
      reject(xDriveTransferAbortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
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
    if (input.signal?.aborted) { reject(xDriveTransferAbortError()); return }
    const xhr = new XMLHttpRequest()
    const progress = xDriveCreateWebDownloadProgressReporter(input.onProgress)
    const abort = () => xhr.abort()
    const cleanup = () => input.signal?.removeEventListener('abort', abort)
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(input.headers)) xhr.setRequestHeader(name, value)
    const bodySize = input.body instanceof Blob ? input.body.size : input.body.byteLength
    xhr.upload.onprogress = (event) => {
      progress.progress(Math.min(bodySize, Math.max(0, event.loaded)))
    }
    // A progress observer may have been disposed while a browser-owned XHR
    // terminal event was still pending. Its exception must not strand the
    // transfer Promise or override the actual HTTP/network outcome.
    const flushProgress = () => { try { progress.flush() } catch { /* optional telemetry */ } }
    xhr.onload = () => {
      cleanup()
      flushProgress()
      if (input.signal?.aborted) { reject(xDriveTransferAbortError()); return }
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
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
      xhr.send(input.body)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
