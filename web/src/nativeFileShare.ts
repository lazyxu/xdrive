/**
 * Small explicit opt-in Web Share payloads only. A user's normal Download
 * remains streaming/direct-to-disk and is never routed through this buffer.
 * Do not construct these bytes for virtual-list thumbnail requests.
 */
export const XDRIVE_NATIVE_SHARE_MAX_BYTES = 16 * 1024 * 1024

/** Missing or denied optional AbortSignal methods cannot authorize media bytes. */
function xDriveAssertNativeShareNotAborted(signal?: AbortSignal): void {
  if (!signal) return
  let observed: unknown
  try { observed = signal.aborted }
  catch { throw new Error('浏览器无法确认系统分享取消状态，请改用下载。') }
  if (typeof observed !== 'boolean') {
    throw new Error('浏览器无法确认系统分享取消状态，请改用下载。')
  }
  if (observed) throw new DOMException('系统分享已取消。', 'AbortError')
}

export async function xDriveReadBoundedNativeShareBlob(
  response: Response,
  signal?: AbortSignal,
  maxBytes = XDRIVE_NATIVE_SHARE_MAX_BYTES,
): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('无效的文件分享大小上限。')
  if (response.status !== 200) throw new Error('文件内容响应不完整，无法通过系统分享。')
  xDriveAssertNativeShareNotAborted(signal)

  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null) {
    const length = Number(lengthHeader)
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('文件内容长度无效。')
    if (length > maxBytes) {
      // Stop a server that has already started sending an oversized response.
      void response.body?.cancel().catch(() => {})
      throw new Error('文件太大，请改用下载或分享链接。')
    }
  }
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim() || 'application/octet-stream'
  if (!response.body) {
    if (lengthHeader === '0') return new Blob([], { type })
    throw new Error('浏览器无法读取该文件的流。')
  }

  const reader = response.body.getReader()
  const parts: ArrayBuffer[] = []
  let loaded = 0
  let ended = false
  const cancel = () => {
    try {
      const cancelling = reader.cancel()
      if (cancelling) void cancelling.catch(() => {})
    } catch { /* A denied reader cancellation cannot escape the abort event. */ }
  }
  let listenerAttached = false
  try {
    if (signal) {
      // The subscription belongs inside the cleanup boundary. A denied
      // listener must never leave the signed media stream locked or readable.
      try {
        signal.addEventListener('abort', cancel, { once: true })
        listenerAttached = true
      } catch {
        throw new Error('浏览器无法监听系统分享取消操作，请改用下载。')
      }
      // Close the signal check -> subscribe race, before reading any bytes.
      xDriveAssertNativeShareNotAborted(signal)
    }
    while (true) {
      xDriveAssertNativeShareNotAborted(signal)
      const { done, value } = await reader.read()
      xDriveAssertNativeShareNotAborted(signal)
      if (done) { ended = true; break }
      if (!value?.byteLength) continue
      if (value.byteLength > maxBytes - loaded) {
        throw new Error('文件太大，请改用下载或分享链接。')
      }
      // Own every chunk before the browser stream reuses its ArrayBuffer.
      const bytes = new Uint8Array(value.byteLength)
      bytes.set(value)
      parts.push(bytes.buffer as ArrayBuffer)
      loaded += bytes.byteLength
    }
    if (lengthHeader !== null && loaded !== Number(lengthHeader)) {
      throw new Error('文件内容大小不一致，请刷新后重试。')
    }
    return new Blob(parts, { type })
  } finally {
    if (listenerAttached) {
      try { signal?.removeEventListener('abort', cancel) }
      catch { /* Optional WebKit cleanup must not mask successful share bytes. */ }
    }
    if (!ended) { try { await reader.cancel() } catch { /* Preserve original error. */ } }
    reader.releaseLock()
  }
}
