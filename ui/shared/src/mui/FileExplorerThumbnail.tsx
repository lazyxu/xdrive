import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { XDriveFileExplorerItem } from './FileExplorer'
import { XDriveLivePhotoGlyph } from './LivePhotoSurface'
import { XDriveMediaLoadingProgress } from './MediaLoadProgress'
import type { XDriveMediaLoadStage } from './MediaLoadProgress'
import type { XDriveByteProgressHandler } from '../file-preview'

export type XDriveFileExplorerThumbnailLoader = (
  item: XDriveFileExplorerItem,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
  onStage?: (stage: XDriveMediaLoadStage) => void,
) => Promise<string | null | undefined>

type FileThumbnailCache = {
  values: Map<string, string>
  leases: Map<string, number>
  retired: Set<string>
  disposed: boolean
}

type FileThumbnailLease = {
  value: string
  release: () => void
}

type FileThumbnailQueueEntry = {
  task: (signal: AbortSignal) => Promise<string | null | undefined>
  controller: AbortController
  resolve: (value: string | null | undefined) => void
  reject: (reason?: unknown) => void
  started: boolean
  cancelled: boolean
}

type FileThumbnailVisibilityEntry = {
  onVisible: () => void
  timer: number | null
}

type XDriveFileExplorerThumbnailContextValue = {
  loadThumbnail?: XDriveFileExplorerThumbnailLoader
  cache: FileThumbnailCache
}

const fileThumbnailConcurrency = 6
const fileThumbnailCacheLimit = 96
const fileThumbnailScrollSettleMs = 80
const fileThumbnailPrefetchMarginPx = 240

let fileThumbnailActive = 0
const fileThumbnailQueue: FileThumbnailQueueEntry[] = []
let fileThumbnailVisibilityObserver: IntersectionObserver | null = null
const fileThumbnailVisibilityCallbacks = new Map<Element, FileThumbnailVisibilityEntry>()
const fileThumbnailScrollActivity = new WeakMap<Element, number>()

const XDriveFileExplorerThumbnailContext =
  createContext<XDriveFileExplorerThumbnailContextValue | null>(null)

function explorerIDKey(id: XDriveFileExplorerItem['id']) {
  return `${typeof id}:${String(id)}`
}

function revokeFileThumbnailSource(value: string | null | undefined) {
  if (value?.startsWith('blob:') && typeof URL !== 'undefined') {
    URL.revokeObjectURL(value)
  }
}

function fileThumbnailCacheKey(item: XDriveFileExplorerItem) {
  return [
    explorerIDKey(item.id),
    String(item.revision ?? ''),
    item.updatedAt ?? '',
  ].join(':')
}

function retireFileThumbnailSource(cache: FileThumbnailCache, value: string | null | undefined) {
  if (!value) return
  if ((cache.leases.get(value) ?? 0) > 0) {
    cache.retired.add(value)
    return
  }
  cache.retired.delete(value)
  revokeFileThumbnailSource(value)
}

function fileThumbnailCacheGet(cache: FileThumbnailCache, key: string) {
  const value = cache.values.get(key)
  if (!value) return null
  cache.values.delete(key)
  cache.values.set(key, value)
  return value
}

function fileThumbnailCacheAcquire(cache: FileThumbnailCache, key: string): FileThumbnailLease | null {
  const value = fileThumbnailCacheGet(cache, key)
  if (!value) return null
  cache.leases.set(value, (cache.leases.get(value) ?? 0) + 1)
  let released = false
  return {
    value,
    release: () => {
      if (released) return
      released = true
      const count = Math.max(0, (cache.leases.get(value) ?? 1) - 1)
      if (count > 0) {
        cache.leases.set(value, count)
        return
      }
      cache.leases.delete(value)
      if (cache.disposed || cache.retired.has(value)) {
        cache.retired.delete(value)
        revokeFileThumbnailSource(value)
      }
    },
  }
}

function fileThumbnailCacheSet(cache: FileThumbnailCache, key: string, value: string) {
  if (cache.disposed) {
    revokeFileThumbnailSource(value)
    return false
  }
  const current = cache.values.get(key)
  if (current && current !== value) retireFileThumbnailSource(cache, current)
  cache.values.delete(key)
  cache.values.set(key, value)
  while (cache.values.size > fileThumbnailCacheLimit) {
    const oldestKey = cache.values.keys().next().value
    if (typeof oldestKey !== 'string') break
    const oldest = cache.values.get(oldestKey)
    cache.values.delete(oldestKey)
    retireFileThumbnailSource(cache, oldest)
  }
  return true
}

function disposeFileThumbnailCache(cache: FileThumbnailCache) {
  cache.disposed = true
  for (const value of cache.values.values()) retireFileThumbnailSource(cache, value)
  cache.values.clear()
}

function pumpFileThumbnailQueue() {
  while (
    fileThumbnailActive < fileThumbnailConcurrency &&
    fileThumbnailQueue.length > 0
  ) {
    const entry = fileThumbnailQueue.shift()!
    if (entry.cancelled) continue
    entry.started = true
    fileThumbnailActive += 1
    void entry.task(entry.controller.signal)
      .then((value) => {
        if (entry.cancelled) {
          revokeFileThumbnailSource(value)
          return
        }
        entry.resolve(value)
      }, (error) => {
        if (!entry.cancelled) entry.reject(error)
      })
      .finally(() => {
        fileThumbnailActive = Math.max(0, fileThumbnailActive - 1)
        pumpFileThumbnailQueue()
      })
  }
}

function scheduleFileThumbnail(task: (signal: AbortSignal) => Promise<string | null | undefined>) {
  let entry!: FileThumbnailQueueEntry
  const promise = new Promise<string | null | undefined>((resolve, reject) => {
    entry = { task, controller: new AbortController(), resolve, reject, started: false, cancelled: false }
    fileThumbnailQueue.push(entry)
    pumpFileThumbnailQueue()
  })
  return {
    promise,
    cancel: () => {
      if (entry.cancelled) return
      entry.cancelled = true
      entry.controller.abort()
      if (!entry.started) {
        const index = fileThumbnailQueue.indexOf(entry)
        if (index >= 0) fileThumbnailQueue.splice(index, 1)
      }
      entry.resolve(undefined)
    },
  }
}

function fileThumbnailNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function xDriveFileExplorerMarkThumbnailScrollActivity(host: Element) {
  fileThumbnailScrollActivity.set(host, fileThumbnailNow())
}

function fileThumbnailScrollRoot(host: Element) {
  return host.closest('[data-xdrive-file-explorer-scroll-host]')
}

function fileThumbnailWithinPrefetchRange(host: Element) {
  const root = fileThumbnailScrollRoot(host)
  if (!(root instanceof HTMLElement)) return true
  const hostRect = host.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  return (
    hostRect.bottom >= rootRect.top - fileThumbnailPrefetchMarginPx &&
    hostRect.top <= rootRect.bottom + fileThumbnailPrefetchMarginPx &&
    hostRect.right >= rootRect.left - fileThumbnailPrefetchMarginPx &&
    hostRect.left <= rootRect.right + fileThumbnailPrefetchMarginPx
  )
}

function fileThumbnailAdmissionDelay(host: Element) {
  const root = fileThumbnailScrollRoot(host)
  if (!root) return 0
  const lastScroll = fileThumbnailScrollActivity.get(root)
  if (lastScroll === undefined) return 0
  return Math.max(0, fileThumbnailScrollSettleMs - (fileThumbnailNow() - lastScroll))
}

function clearFileThumbnailVisibilityTimer(entry: FileThumbnailVisibilityEntry) {
  if (entry.timer === null) return
  window.clearTimeout(entry.timer)
  entry.timer = null
}

function admitFileThumbnailVisibility(host: Element, observer: IntersectionObserver) {
  const entry = fileThumbnailVisibilityCallbacks.get(host)
  if (!entry) return
  const delay = fileThumbnailAdmissionDelay(host)
  if (delay > 0) {
    if (entry.timer === null) {
      entry.timer = window.setTimeout(() => {
        entry.timer = null
        if (!fileThumbnailVisibilityCallbacks.has(host)) return
        if (!fileThumbnailWithinPrefetchRange(host)) return
        admitFileThumbnailVisibility(host, observer)
      }, Math.ceil(delay))
    }
    return
  }
  clearFileThumbnailVisibilityTimer(entry)
  fileThumbnailVisibilityCallbacks.delete(host)
  observer.unobserve(host)
  entry.onVisible()
}

function observeFileThumbnailVisibility(host: Element, onVisible: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible()
    return () => {}
  }
  if (!fileThumbnailVisibilityObserver) {
    const observer = new IntersectionObserver((entries) => {
      for (const observed of entries) {
        const entry = fileThumbnailVisibilityCallbacks.get(observed.target)
        if (!entry) continue
        if (!observed.isIntersecting) {
          clearFileThumbnailVisibilityTimer(entry)
          continue
        }
        admitFileThumbnailVisibility(observed.target, observer)
      }
      if (fileThumbnailVisibilityCallbacks.size === 0) {
        observer.disconnect()
        if (fileThumbnailVisibilityObserver === observer) {
          fileThumbnailVisibilityObserver = null
        }
      }
    }, { rootMargin: `${fileThumbnailPrefetchMarginPx}px` })
    fileThumbnailVisibilityObserver = observer
  }
  const observer = fileThumbnailVisibilityObserver
  fileThumbnailVisibilityCallbacks.set(host, { onVisible, timer: null })
  observer.observe(host)
  return () => {
    const entry = fileThumbnailVisibilityCallbacks.get(host)
    if (entry) clearFileThumbnailVisibilityTimer(entry)
    fileThumbnailVisibilityCallbacks.delete(host)
    observer.unobserve(host)
    if (fileThumbnailVisibilityCallbacks.size === 0) {
      observer.disconnect()
      if (fileThumbnailVisibilityObserver === observer) {
        fileThumbnailVisibilityObserver = null
      }
    }
  }
}

export function XDriveFileExplorerThumbnailProvider({
  lifecycleKey = '',
  loadThumbnail,
  children,
}: {
  lifecycleKey?: string
  loadThumbnail?: XDriveFileExplorerThumbnailLoader
  children: ReactNode
}) {
  const cache = useMemo<FileThumbnailCache>(
    () => ({
      values: new Map(),
      leases: new Map(),
      retired: new Set(),
      disposed: false,
    }),
    [lifecycleKey, loadThumbnail],
  )

  useEffect(() => {
    cache.disposed = false
    return () => disposeFileThumbnailCache(cache)
  }, [cache])

  const value = useMemo(() => ({ loadThumbnail, cache }), [cache, loadThumbnail])

  return (
    <XDriveFileExplorerThumbnailContext.Provider value={value}>
      {children}
    </XDriveFileExplorerThumbnailContext.Provider>
  )
}

export function XDriveFileExplorerThumbnail({
  item,
  eligible,
  fallback,
  sx,
}: {
  item: XDriveFileExplorerItem
  eligible: boolean
  fallback: ReactNode
  sx?: SxProps<Theme>
}) {
  const context = useContext(XDriveFileExplorerThumbnailContext)
  const livePhoto = item.kind === 'file' && item.name.trim().toLowerCase().endsWith('.livp')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const itemRef = useRef(item)
  itemRef.current = item
  const cacheKey = fileThumbnailCacheKey(item)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState<{ loadedBytes: number; totalBytes?: number }>({ loadedBytes: 0 })
  const [stage, setStage] = useState<XDriveMediaLoadStage>('transfer')
  const leaseRef = useRef<FileThumbnailLease | null>(null)
  const loadThumbnail = context?.loadThumbnail
  const cache = context?.cache

  useEffect(() => {
    setFailed(false)
    setStage('transfer')
    setProgress({ loadedBytes: 0 })
    const lease = cache ? fileThumbnailCacheAcquire(cache, cacheKey) : null
    const previous = leaseRef.current
    leaseRef.current = lease
    previous?.release()
    setSrc(lease?.value ?? null)
    return () => {
      if (leaseRef.current !== lease) return
      leaseRef.current = null
      lease?.release()
    }
  }, [cache, cacheKey])

  useEffect(() => {
    const host = hostRef.current
    if (
      !host || visible || src || item.thumbnail ||
      !eligible || !loadThumbnail
    ) return
    return observeFileThumbnailVisibility(host, () => setVisible(true))
  }, [eligible, item.thumbnail, loadThumbnail, src, visible])

  useEffect(() => {
    if (
      !cache || !loadThumbnail || !eligible || !visible ||
      failed || src || item.thumbnail
    ) return
    const cached = fileThumbnailCacheAcquire(cache, cacheKey)
    if (cached) {
      const previous = leaseRef.current
      leaseRef.current = cached
      previous?.release()
      setSrc(cached.value)
      return
    }
    let active = true
    const requestedItem = itemRef.current
    const scheduled = scheduleFileThumbnail((signal) => loadThumbnail(
      requestedItem, signal,
      (loadedBytes, totalBytes) => {
        if (active && !signal.aborted) setProgress({ loadedBytes, totalBytes })
      },
      (nextStage) => { if (active && !signal.aborted) setStage(nextStage) },
    ))
    void scheduled.promise
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        if (!fileThumbnailCacheSet(cache, cacheKey, value)) return
        if (active) {
          const lease = fileThumbnailCacheAcquire(cache, cacheKey)
          const previous = leaseRef.current
          leaseRef.current = lease
          previous?.release()
          setSrc(lease?.value ?? null)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      scheduled.cancel()
    }
  }, [
    cache,
    cacheKey,
    eligible,
    failed,
    item.thumbnail,
    loadThumbnail,
    src,
    visible,
  ])

  return (
    <Box
      ref={hostRef}
      data-xdrive-file-explorer-item-visual
      sx={[
        {
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {item.thumbnail ?? (src ? (
        <Box
          component="img"
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : fallback)}
      {eligible && visible && !src && !failed && !item.thumbnail && loadThumbnail ? (
        <XDriveMediaLoadingProgress compact stage={stage} {...progress} />
      ) : null}
      {livePhoto && !failed && Boolean(item.thumbnail || src) ? (
        <Box
          component="span"
          title="实况照片"
          aria-label="实况照片"
          sx={{
            position: 'absolute',
            left: 2,
            top: 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.56)',
            color: 'common.white',
            pointerEvents: 'none',
          }}
        >
          <XDriveLivePhotoGlyph size={10} />
        </Box>
      ) : null}
    </Box>
  )
}
