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
    body: ArrayBuffer
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
    xhr.upload.onprogress = (event) => {
      progress.progress(Math.min(input.body.byteLength, Math.max(0, event.loaded)))
    }
    xhr.onload = () => {
      cleanup()
      progress.flush()
      resolve(new Response(xhr.responseText || null, { status: xhr.status, statusText: xhr.statusText }))
    }
    xhr.onerror = () => {
      cleanup()
      progress.flush()
      reject(new TypeError('上传连接失败。'))
    }
    xhr.ontimeout = () => {
      cleanup()
      progress.flush()
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
