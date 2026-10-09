/**
 * Small explicit opt-in Web Share payloads only. A user's normal Download
 * remains streaming/direct-to-disk and is never routed through this buffer.
 * Do not construct these bytes for virtual-list thumbnail requests.
 */
export const XDRIVE_NATIVE_SHARE_MAX_BYTES = 16 * 1024 * 1024

export async function xDriveReadBoundedNativeShareBlob(
  response: Response,
  signal?: AbortSignal,
  maxBytes = XDRIVE_NATIVE_SHARE_MAX_BYTES,
): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('无效的文件分享大小上限。')
  if (response.status !== 200) throw new Error('文件内容响应不完整，无法通过系统分享。')
  signal?.throwIfAborted()

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
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
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
    signal?.removeEventListener('abort', cancel)
    if (!ended) { try { await reader.cancel() } catch { /* Preserve original error. */ } }
    reader.releaseLock()
  }
}
