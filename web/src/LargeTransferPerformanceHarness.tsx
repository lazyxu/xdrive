import { useEffect } from 'react'
import type { Node } from '../../ui/shared/src'
import { XDriveApi } from './api'

export type XDriveLargeTransferPerformanceScenario = 'upload' | 'download' | 'download-discard'

type PerfMemory = Performance & {
  memory?: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit: number
  }
}

type PerfOPFSWritable = {
  truncate(size: number): Promise<void>
  write(data: Uint8Array | Blob): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

type PerfOPFSFileHandle = {
  getFile(): Promise<File>
  createWritable(): Promise<PerfOPFSWritable>
}

type PerfOPFSDirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<PerfOPFSFileHandle>
  removeEntry(name: string): Promise<void>
}

type LargeTransferPerfResult = {
  scenario: XDriveLargeTransferPerformanceScenario
  sample: string
  sizeBytes: number
  elapsedMs: number
  throughputMiBps: number
  heapStartBytes: number | null
  heapPeakBytes: number | null
  heapDeltaBytes: number | null
  prehashMs?: number | null
  uploadSessionMs?: number | null
  uploadChunksMs?: number | null
  uploadFinalizeMs?: number | null
  downloadHeadersMs?: number | null
  downloadStreamWriteMs?: number | null
}

type LargeTransferPerfWindow = Window & {
  __xdriveLargeTransferPerfResult?: LargeTransferPerfResult
  __xdriveLargeTransferPerfError?: string
  __xdriveLargeTransferPerfRunning?: boolean
  __xdriveLargeTransferPerfReady?: boolean
  __xdriveLargeTransferPerfStart?: boolean
}

type FetchMarkers = {
  uploadSessionRequestAt?: number
  uploadSessionResponseAt?: number
  uploadFinalizeRequestAt?: number
  downloadRequestAt?: number
  downloadResponseAt?: number
}

const mib = 1024 * 1024

function currentHeapBytes() {
  return (performance as PerfMemory).memory?.usedJSHeapSize ?? null
}

function requestPath(input: RequestInfo | URL) {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  return new URL(raw, window.location.href).pathname
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (
    init?.method ??
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
}

function installFetchMarkers(markers: FetchMarkers) {
  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = requestMethod(input, init)
    const path = requestPath(input)
    const now = performance.now()
    let responseMarker: keyof FetchMarkers | null = null
    if (method === 'POST' && path === '/api/v1/uploads') {
      markers.uploadSessionRequestAt ??= now
      responseMarker = 'uploadSessionResponseAt'
    } else if (method === 'POST' && path.endsWith('/finalize')) {
      markers.uploadFinalizeRequestAt ??= now
    } else if (method === 'GET' && path === '/api/v1/files/99/content') {
      markers.downloadRequestAt ??= now
      responseMarker = 'downloadResponseAt'
    }
    const response = originalFetch(input, init)
    if (!responseMarker) return response
    return response.then((value) => {
      markers[responseMarker!] ??= performance.now()
      return value
    })
  }) as typeof globalThis.fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

async function waitForUploadFile(sizeBytes: number) {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    const input = document.querySelector<HTMLInputElement>('[data-xdrive-large-transfer-upload-file]')
    const file = input?.files?.[0]
    if (file) {
      if (file.size !== sizeBytes) throw new Error(`upload fixture size=${file.size} want=${sizeBytes}`)
      return file
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('timed out waiting for native upload fixture')
}

async function removeOPFSEntry(root: PerfOPFSDirectoryHandle, name: string) {
  try {
    await root.removeEntry(name)
  } catch {
    // Best-effort benchmark cleanup.
  }
}

export function XDriveLargeTransferPerformanceHarness({
  scenario,
  sample,
}: {
  scenario: XDriveLargeTransferPerformanceScenario
  sample: string
}) {
  const requestedSizeGiB = new URLSearchParams(window.location.search).get('xdriveLargeTransferSizeGiB') ?? '1'
  useEffect(() => {
    const perfWindow = window as LargeTransferPerfWindow
    let cancelled = false

    void (async () => {
      if (scenario !== 'upload' && scenario !== 'download' && scenario !== 'download-discard') {
        throw new Error(`unsupported large-transfer scenario: ${scenario}`)
      }
      if (requestedSizeGiB !== '1' && requestedSizeGiB !== '4') {
        throw new Error(`unsupported large-transfer size GiB: ${requestedSizeGiB}`)
      }
      const sizeBytes = Number(requestedSizeGiB) * 2 ** 30
      const storage = navigator.storage as unknown as {
        getDirectory?: () => Promise<PerfOPFSDirectoryHandle>
      }
      if (typeof storage.getDirectory !== 'function') {
        throw new Error('OPFS getDirectory is unavailable in this renderer')
      }

      const root = await storage.getDirectory()
      const downloadName = `xdrive-large-download-${sample}.bin`
      const markers: FetchMarkers = {}
      const restoreFetch = installFetchMarkers(markers)
      const pickerGlobal = globalThis as typeof globalThis & {
        showSaveFilePicker?: () => Promise<PerfOPFSFileHandle>
      }
      const originalPicker = pickerGlobal.showSaveFilePicker
      let heapPeak = currentHeapBytes()
      let heapTimer = 0

      try {
        const api = new XDriveApi({
          accessToken: 'perf-token',
          refreshToken: '',
          accessExpiresAt: Date.now() + 60 * 60_000,
        })

        let uploadFile: File | null = null
        if (scenario === 'upload') {
          uploadFile = await waitForUploadFile(sizeBytes)
        } else if (scenario === 'download') {
          const targetHandle = await root.getFileHandle(downloadName, { create: true })
          pickerGlobal.showSaveFilePicker = async () => targetHandle
        } else {
          pickerGlobal.showSaveFilePicker = async () => ({
            async getFile() {
              throw new Error('discard sink has no file')
            },
            async createWritable() {
              return {
                async write() {},
                async truncate() {},
                async close() {},
                async abort() {},
              }
            },
          })
        }

        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        if (cancelled) return

        // The launcher samples the idle renderer before releasing this gate.
        // Observing `running` after an asynchronous IPC poll is already too late
        // to establish a memory baseline for a fast loopback transfer.
        perfWindow.__xdriveLargeTransferPerfReady = true
        const startDeadline = performance.now() + 30_000
        while (!perfWindow.__xdriveLargeTransferPerfStart) {
          if (cancelled) return
          if (performance.now() >= startDeadline) throw new Error('timed out waiting for launcher start gate')
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        const heapStart = currentHeapBytes()
        if (heapStart === null) throw new Error('precise JS heap memory metrics are unavailable')
        heapPeak = heapStart
        heapTimer = window.setInterval(() => {
          const value = currentHeapBytes()
          if (value !== null) heapPeak = Math.max(heapPeak ?? value, value)
        }, 20)

        perfWindow.__xdriveLargeTransferPerfRunning = true
        const startedAt = performance.now()

        if (scenario === 'upload') {
          const result = await api.uploadWithConflictPolicy(1, uploadFile!, 'fail')
          if (result.transferred_bytes !== sizeBytes || result.skipped) {
            throw new Error(
              `upload transferred=${result.transferred_bytes} skipped=${result.skipped}`,
            )
          }
        } else {
          const saved = await api.download({
            id: 99,
            parent_id: 1,
            name: downloadName,
            type: 'file',
            size: sizeBytes,
            revision: 1,
          } as Node)
          if (!saved) throw new Error('download was unexpectedly cancelled')
          if (scenario === 'download') {
            const downloaded = await (await root.getFileHandle(downloadName)).getFile()
            if (downloaded.size !== sizeBytes) {
              throw new Error(`downloaded size=${downloaded.size} want=${sizeBytes}`)
            }
          }
        }

        const endedAt = performance.now()
        const heapEnd = currentHeapBytes()
        if (heapEnd !== null) heapPeak = Math.max(heapPeak ?? heapEnd, heapEnd)
        const elapsedMs = endedAt - startedAt

        const result: LargeTransferPerfResult = {
          scenario,
          sample,
          sizeBytes,
          elapsedMs,
          throughputMiBps: (sizeBytes / mib) / (elapsedMs / 1000),
          heapStartBytes: heapStart,
          heapPeakBytes: heapPeak,
          heapDeltaBytes: heapStart === null || heapPeak === null ? null : heapPeak - heapStart,
        }

        if (scenario === 'upload') {
          result.prehashMs = markers.uploadSessionRequestAt === undefined
            ? null
            : markers.uploadSessionRequestAt - startedAt
          result.uploadSessionMs = markers.uploadSessionRequestAt === undefined || markers.uploadSessionResponseAt === undefined
            ? null
            : markers.uploadSessionResponseAt - markers.uploadSessionRequestAt
          result.uploadChunksMs = markers.uploadSessionResponseAt === undefined || markers.uploadFinalizeRequestAt === undefined
            ? null
            : markers.uploadFinalizeRequestAt - markers.uploadSessionResponseAt
          result.uploadFinalizeMs = markers.uploadFinalizeRequestAt === undefined
            ? null
            : endedAt - markers.uploadFinalizeRequestAt
        } else {
          result.downloadHeadersMs = markers.downloadRequestAt === undefined || markers.downloadResponseAt === undefined
            ? null
            : markers.downloadResponseAt - markers.downloadRequestAt
          result.downloadStreamWriteMs = markers.downloadResponseAt === undefined
            ? null
            : endedAt - markers.downloadResponseAt
        }

        perfWindow.__xdriveLargeTransferPerfResult = result
        console.log('__XDRIVE_LARGE_TRANSFER_PERF_METRICS__' + JSON.stringify(result))
      } finally {
        perfWindow.__xdriveLargeTransferPerfReady = false
        perfWindow.__xdriveLargeTransferPerfRunning = false
        if (heapTimer) window.clearInterval(heapTimer)
        restoreFetch()
        if (originalPicker === undefined) delete pickerGlobal.showSaveFilePicker
        else pickerGlobal.showSaveFilePicker = originalPicker
        await removeOPFSEntry(root, downloadName)
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.stack || error.message : String(error)
      perfWindow.__xdriveLargeTransferPerfRunning = false
      perfWindow.__xdriveLargeTransferPerfError = message
      console.error('__XDRIVE_LARGE_TRANSFER_PERF_ERROR__' + message)
    })

    return () => {
      cancelled = true
    }
  }, [sample, scenario, requestedSizeGiB])

  return (
    <>
      <input data-xdrive-large-transfer-upload-file type="file" hidden />
      <div data-xdrive-large-transfer-performance>Measuring {requestedSizeGiB} GiB {scenario}…</div>
    </>
  )
}
