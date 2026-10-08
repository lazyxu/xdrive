export interface XDriveWebWritableDownloadFile {
  write(data: Uint8Array | Blob): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

interface XDriveWebDownloadFileHandle {
  createWritable(): Promise<XDriveWebWritableDownloadFile>
}

type XDriveWebSaveFilePicker = (options: {
  suggestedName?: string
}) => Promise<XDriveWebDownloadFileHandle>

type XDriveWebDownloadGlobal = typeof globalThis & {
  showSaveFilePicker?: XDriveWebSaveFilePicker
}

export type XDriveWebDownloadSink =
  | {
      kind: 'file-system'
      writable: XDriveWebWritableDownloadFile
      settled: boolean
    }
  | { kind: 'blob' }
  | { kind: 'cancelled' }

export type XDriveWebActiveDownloadSink = Exclude<
  XDriveWebDownloadSink,
  { kind: 'cancelled' }
>

export const xDriveWebDownloadProgressIntervalMs = 100
export const xDriveWebDownloadProgressByteStep = 8 * 1024 * 1024

export function xDriveCreateWebDownloadProgressReporter(
  report: (done: number) => void,
  options: {
    intervalMs?: number
    byteStep?: number
    now?: () => number
  } = {},
) {
  const intervalMs = Math.max(0, options.intervalMs ?? xDriveWebDownloadProgressIntervalMs)
  const byteStep = Math.max(1, options.byteStep ?? xDriveWebDownloadProgressByteStep)
  const now = options.now ?? (() => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  ))
  let lastPublishedAt = now()
  let lastPublishedDone = 0
  let latestDone = 0

  const publish = (force: boolean) => {
    if (latestDone <= lastPublishedDone) return false
    const current = now()
    if (
      !force &&
      latestDone - lastPublishedDone < byteStep &&
      current - lastPublishedAt < intervalMs
    ) {
      return false
    }
    lastPublishedDone = latestDone
    lastPublishedAt = current
    report(latestDone)
    return true
  }

  return {
    progress(done: number) {
      latestDone = Math.max(latestDone, Math.max(0, done))
      return publish(false)
    },
    flush() {
      return publish(true)
    },
  }
}

function xDriveWebDownloadCancelled(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError',
  )
}

export async function xDriveOpenWebDownloadSink(
  filename: string,
): Promise<XDriveWebDownloadSink> {
  const picker = (globalThis as XDriveWebDownloadGlobal).showSaveFilePicker
  if (typeof picker !== 'function') return { kind: 'blob' }

  try {
    const handle = await picker({ suggestedName: filename })
    return {
      kind: 'file-system',
      writable: await handle.createWritable(),
      settled: false,
    }
  } catch (error) {
    if (xDriveWebDownloadCancelled(error)) return { kind: 'cancelled' }
    throw error
  }
}

export async function xDriveAbortWebDownloadSink(
  sink: XDriveWebActiveDownloadSink,
  reason?: unknown,
) {
  if (sink.kind !== 'file-system' || sink.settled) return
  sink.settled = true
  try {
    await sink.writable.abort(reason)
  } catch {
    // Preserve the original transport failure.
  }
}

export async function xDriveWriteWebDownloadToSink(
  body: ReadableStream<Uint8Array> | null,
  sink: Extract<XDriveWebActiveDownloadSink, { kind: 'file-system' }>,
  fallbackBlob: () => Promise<Blob>,
  onProgress?: (done: number) => void,
) {
  let completed = 0
  try {
    if (body) {
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value || value.byteLength === 0) continue
          await sink.writable.write(value)
          completed += value.byteLength
          onProgress?.(completed)
        }
      } catch (error) {
        try {
          await reader.cancel(error)
        } catch {
          // Preserve the original read/write failure.
        }
        throw error
      } finally {
        reader.releaseLock()
      }
    } else {
      const blob = await fallbackBlob()
      await sink.writable.write(blob)
      completed = blob.size
      onProgress?.(completed)
    }

    await sink.writable.close()
    sink.settled = true
    return completed
  } catch (error) {
    await xDriveAbortWebDownloadSink(sink, error)
    throw error
  }
}


export function xDriveStartBrowserDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}
