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
