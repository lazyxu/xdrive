import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { XDriveFileExplorerItem } from './FileExplorer'

export type XDriveFileExplorerThumbnailLoader = (
  item: XDriveFileExplorerItem,
) => Promise<string | null | undefined>

type FileThumbnailCache = {
  values: Map<string, string>
  disposed: boolean
}

type FileThumbnailQueueEntry = {
  task: () => Promise<string | null | undefined>
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

function fileThumbnailCacheGet(cache: FileThumbnailCache, key: string) {
  const value = cache.values.get(key)
  if (!value) return null
  cache.values.delete(key)
  cache.values.set(key, value)
  return value
}

function fileThumbnailCacheSet(cache: FileThumbnailCache, key: string, value: string) {
  if (cache.disposed) {
    revokeFileThumbnailSource(value)
    return false
  }
  const current = cache.values.get(key)
  if (current && current !== value) revokeFileThumbnailSource(current)
  cache.values.delete(key)
  cache.values.set(key, value)
  while (cache.values.size > fileThumbnailCacheLimit) {
    const oldestKey = cache.values.keys().next().value
    if (typeof oldestKey !== 'string') break
    const oldest = cache.values.get(oldestKey)
    cache.values.delete(oldestKey)
    revokeFileThumbnailSource(oldest)
  }
  return true
}

function disposeFileThumbnailCache(cache: FileThumbnailCache) {
  cache.disposed = true
  for (const value of cache.values.values()) revokeFileThumbnailSource(value)
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
    void entry.task()
      .then(entry.resolve, entry.reject)
      .finally(() => {
        fileThumbnailActive = Math.max(0, fileThumbnailActive - 1)
        pumpFileThumbnailQueue()
      })
  }
}

function scheduleFileThumbnail(task: () => Promise<string | null | undefined>) {
  let entry!: FileThumbnailQueueEntry
  const promise = new Promise<string | null | undefined>((resolve, reject) => {
    entry = { task, resolve, reject, started: false, cancelled: false }
    fileThumbnailQueue.push(entry)
    pumpFileThumbnailQueue()
  })
  return {
    promise,
    cancel: () => {
      if (entry.started || entry.cancelled) return
      entry.cancelled = true
      const index = fileThumbnailQueue.indexOf(entry)
      if (index >= 0) fileThumbnailQueue.splice(index, 1)
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
  loadThumbnail,
  children,
}: {
  loadThumbnail?: XDriveFileExplorerThumbnailLoader
  children: ReactNode
}) {
  const cache = useMemo<FileThumbnailCache>(
    () => ({ values: new Map(), disposed: false }),
    [loadThumbnail],
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
  const loadThumbnail = context?.loadThumbnail
  const cache = context?.cache

  useEffect(() => {
    setFailed(false)
    setSrc(cache ? fileThumbnailCacheGet(cache, cacheKey) : null)
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
    const cached = fileThumbnailCacheGet(cache, cacheKey)
    if (cached) {
      setSrc(cached)
      return
    }
    let active = true
    const requestedItem = itemRef.current
    const scheduled = scheduleFileThumbnail(() => loadThumbnail(requestedItem))
    void scheduled.promise
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        if (!fileThumbnailCacheSet(cache, cacheKey, value)) return
        if (active) setSrc(value)
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
      {livePhoto ? (
        <Box
          component="span"
          title="实况照片"
          aria-label="实况照片"
          sx={{
            position: 'absolute',
            left: 3,
            top: 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.56)',
            color: 'common.white',
            pointerEvents: 'none',
          }}
        >
          <PlayCircleOutlineRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
      ) : null}
    </Box>
  )
}
