import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import {
  XDriveFileExplorer,
  type XDriveFileExplorerItem,
  type XDriveFileExplorerVirtualCollection,
  type XDriveFileExplorerViewMode,
} from '@xdrive/ui/mui'

type RealFileExplorerConfig = {
  token: string
  folder_id: number
  logical_count: number
  physical_images: number
  seed_ms: number
}

type NodeDTO = {
  id: number
  name: string
  type: 'file' | 'dir'
  size: number
  revision: number
  updated_at: string
}

type ChildrenPage = {
  items: NodeDTO[]
  total_count: number
  offset: number
  limit: number
}

declare global {
  interface Window {
    __xdriveFileExplorerRealScrollError?: string
  }
}

const pageSize = 200
const sort = { key: 'name' as const, direction: 'asc' as const }
const viewMode: XDriveFileExplorerViewMode = new URLSearchParams(window.location.search)
  .get('xdriveFileExplorerViewMode') === 'details' ? 'details' : 'grid'

// Opt-in benchmark only. Uses the actual shared FileExplorer and thumbnail
// scheduler with real signed Gin/PG17/CAS HTTP; no production data adapter.
export function XDriveFileExplorerRealScrollPerformanceHarness() {
  const [config, setConfig] = useState<RealFileExplorerConfig | null>(null)
  const [loadedItems, setLoadedItems] = useState<ReadonlyMap<number, XDriveFileExplorerItem>>(
    () => new Map(),
  )
  const rangeKeyRef = useRef('')
  const rangeAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/__perf/config', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('real FileExplorer config HTTP ' + response.status)
        return response.json() as Promise<RealFileExplorerConfig>
      })
      .then((next) => {
        if (next.logical_count !== 100_000 || next.physical_images !== 16) {
          throw new Error('invalid real 100k FileExplorer fixture shape')
        }
        setConfig(next)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          window.__xdriveFileExplorerRealScrollError = String(error)
        }
      })
    return () => {
      controller.abort()
      rangeAbortRef.current?.abort()
    }
  }, [])

  const onRangeChange = useCallback((start: number, end: number) => {
    if (!config || end <= start) return
    const firstPage = Math.floor(start / pageSize)
    const lastPage = Math.floor((end - 1) / pageSize)
    const key = firstPage + ':' + lastPage
    if (rangeKeyRef.current === key) return
    rangeKeyRef.current = key
    rangeAbortRef.current?.abort()
    const controller = new AbortController()
    rangeAbortRef.current = controller
    const headers = { Authorization: 'Bearer ' + config.token }
    const offsets = Array.from(
      { length: Math.min(6, lastPage - firstPage + 1) },
      (_unused, index) => (firstPage + index) * pageSize,
    )
    void Promise.all(offsets.map(async (offset) => {
      const response = await fetch(
        '/api/v1/nodes/' + config.folder_id +
          '/children?offset=' + offset + '&limit=' + pageSize + '&sort=name&order=asc',
        { headers, signal: controller.signal, cache: 'no-store' },
      )
      if (!response.ok) throw new Error('real FileExplorer 100k range HTTP ' + response.status)
      const page = await response.json() as ChildrenPage
      if (page.total_count !== config.logical_count || page.offset !== offset) {
        throw new Error('invalid real FileExplorer 100k range at ' + offset)
      }
      return page
    })).then((pages) => {
      if (controller.signal.aborted) return
      const next = new Map<number, XDriveFileExplorerItem>()
      for (const page of pages) {
        page.items.forEach((node, index) => {
          next.set(page.offset + index, {
            id: node.id,
            name: node.name,
            kind: node.type,
            fileKind: 'image',
            thumbnailEligible: true,
            size: node.size,
            revision: node.revision,
            updatedAt: node.updated_at,
            path: '100k Images/' + node.name,
          })
        })
      }
      setLoadedItems(next)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        window.__xdriveFileExplorerRealScrollError = String(error)
      }
    })
  }, [config])

  const virtualCollection = useMemo<XDriveFileExplorerVirtualCollection>(() => ({
    interactionKey: 'real-100k-image-namespace',
    itemCount: config?.logical_count ?? 0,
    loadedItems,
    itemAt: (index) => loadedItems.get(index),
    onRangeChange,
  }), [config, loadedItems, onRangeChange])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (!config || signal?.aborted) return null
    const response = await fetch('/api/v1/media/items/' + item.id + '/thumbnail', {
      headers: { Authorization: 'Bearer ' + config.token },
      signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('real FileExplorer JPEG ' + item.id + ' HTTP ' + response.status)
    const blob = await response.blob()
    if (signal?.aborted) return null
    return URL.createObjectURL(blob)
  }, [config])

  return (
    <Box sx={{ width: '100vw', height: '100vh', boxSizing: 'border-box', p: 1, bgcolor: 'background.default' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">FileExplorer 100k real HTTP viewport</Typography>
        <Chip size="small" label={viewMode} />
        <Chip size="small" label="PostgreSQL + signed JPEG" variant="outlined" />
      </Stack>
      <Box sx={{ height: 'calc(100vh - 48px)', minHeight: 0 }}>
        <XDriveFileExplorer
          presentation="workspace"
          items={[]}
          crumbs={[{ id: config?.folder_id ?? 0, name: '100k Images' }]}
          pathValue="100k Images"
          viewMode={viewMode}
          onViewModeChange={() => {}}
          sort={sort}
          onSortChange={() => {}}
          externallySorted
          virtualCollection={virtualCollection}
          loadThumbnail={loadThumbnail}
          statusText="100,000 项"
        />
      </Box>
    </Box>
  )
}
