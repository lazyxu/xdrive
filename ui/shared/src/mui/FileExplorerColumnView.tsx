import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import {
  Box,
  Button,
  CircularProgress,
  List,
  ListItemButton,
  Stack,
  Typography,
} from '@mui/material'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { XDriveAutoLoadSentinel } from './AutoLoadSentinel'
import { useXDriveDeferredLoading } from './useDeferredLoading'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerID,
  XDriveFileExplorerItem,
} from './FileExplorer'

export type XDriveFileExplorerColumnPage = {
  items: XDriveFileExplorerItem[]
  nextCursor?: string
}

type ColumnState = {
  items: XDriveFileExplorerItem[]
  nextCursor: string
  loading: boolean
  loaded: boolean
  error: boolean
  generation: number
}

const emptyColumn = (): ColumnState => ({
  items: [],
  nextCursor: '',
  loading: false,
  loaded: false,
  error: false,
  generation: 0,
})

// The column scroll host is fixed; a pending Range must never insert a
// temporary spinner row that pushes real files down. Requests run immediately,
// while decorative progress belongs to the current generation after 300ms.
function ColumnNetworkFeedback({
  loading,
  generation,
}: {
  loading: boolean
  generation: number
}) {
  const visible = useXDriveDeferredLoading(loading, generation)
  return visible ? (
    <Box data-xdrive-column-loading role="status" aria-label="正在读取文件夹"
      sx={{
        position: 'absolute', right: 8, bottom: 8, zIndex: 2,
        pointerEvents: 'none', p: 0.5, borderRadius: 1,
        bgcolor: 'background.paper',
      }}>
      <CircularProgress size={18} />
    </Box>
  ) : null
}

export function XDriveFileExplorerColumnView({
  lifecycleKey = '',
  crumbs,
  selectedIDs,
  loadPage,
  onNavigate,
  onSelect,
  onOpenFile,
  onItemContextMenu,
}: {
  lifecycleKey?: string
  crumbs: readonly XDriveFileExplorerCrumb[]
  selectedIDs: readonly XDriveFileExplorerID[]
  loadPage: (parentID: XDriveFileExplorerID, cursor: string, signal: AbortSignal) => Promise<XDriveFileExplorerColumnPage>
  onNavigate: (crumbs: XDriveFileExplorerCrumb[]) => void | Promise<void>
  onSelect: (item: XDriveFileExplorerItem) => void
  onOpenFile: (item: XDriveFileExplorerItem) => void
  onItemContextMenu?: (event: ReactMouseEvent<HTMLElement>, item: XDriveFileExplorerItem) => void
}) {
  const [columns, setColumns] = useState<Record<string, ColumnState>>({})
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const controllersRef = useRef(new Map<string, AbortController>())
  const generationRef = useRef(new Map<string, number>())
  const lifecycleKeyRef = useRef(lifecycleKey)
  const crumbSignature = crumbs.map((crumb) => String(crumb.id)).join('/')
  const ownerCurrent = lifecycleKeyRef.current === lifecycleKey
  const displayColumns = ownerCurrent ? columns : {}

  const load = useCallback(async (parentID: XDriveFileExplorerID, append: boolean) => {
    const key = String(parentID)
    const current = columnsRef.current[key] ?? emptyColumn()
    if (current.loading || (append && !current.nextCursor)) return
    const generation = (generationRef.current.get(key) ?? 0) + 1
    generationRef.current.set(key, generation)
    controllersRef.current.get(key)?.abort()
    const controller = new AbortController()
    controllersRef.current.set(key, controller)
    const cursor = append ? current.nextCursor : ''
    setColumns((value) => ({
      ...value,
      [key]: { ...(value[key] ?? emptyColumn()), loading: true, error: false, generation },
    }))
    try {
      const page = await loadPage(parentID, cursor, controller.signal)
      if (controller.signal.aborted || generationRef.current.get(key) !== generation) return
      setColumns((value) => {
        const before = value[key] ?? emptyColumn()
        const seen = new Set((append ? before.items : []).map((item) => String(item.id)))
        const items = append ? [...before.items] : []
        for (const item of page.items) {
          if (!seen.has(String(item.id))) {
            seen.add(String(item.id))
            items.push(item)
          }
        }
        return {
          ...value,
          [key]: {
            items,
            nextCursor: page.nextCursor ?? '',
            loading: false,
            loaded: true,
            error: false,
            generation,
          },
        }
      })
    } catch (error) {
      if (controller.signal.aborted || generationRef.current.get(key) !== generation) return
      setColumns((value) => ({
        ...value,
        [key]: { ...(value[key] ?? emptyColumn()), loading: false, error: true, generation },
      }))
      throw error
    }
  }, [loadPage])

  useEffect(() => {
    if (lifecycleKeyRef.current !== lifecycleKey) {
      lifecycleKeyRef.current = lifecycleKey
      for (const controller of controllersRef.current.values()) controller.abort()
      controllersRef.current.clear()
      generationRef.current.clear()
      columnsRef.current = {}
      setColumns({})
    }

    const activeKeys = new Set(crumbs.map((crumb) => String(crumb.id)))
    setColumns((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => activeKeys.has(key)),
    ))
    for (const [key, controller] of controllersRef.current) {
      if (!activeKeys.has(key)) {
        controller.abort()
        controllersRef.current.delete(key)
        generationRef.current.delete(key)
      }
    }
    for (const crumb of crumbs) {
      const state = columnsRef.current[String(crumb.id)]
      if (!state?.loaded && !state?.loading && !state?.error) {
        void load(crumb.id, false).catch(() => undefined)
      }
    }
  }, [crumbSignature, crumbs, lifecycleKey, load])

  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
  }, [])

  const selected = useMemo(() => new Set(selectedIDs.map(String)), [selectedIDs])

  return (
    <Box
      data-xdrive-file-explorer-column-view
      role="list"
      aria-label="分栏文件视图"
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        display: 'flex',
        alignItems: 'stretch',
        bgcolor: 'background.paper',
      }}
    >
      {crumbs.map((crumb, columnIndex) => {
        const state = displayColumns[String(crumb.id)] ?? emptyColumn()
        const nextCrumbID = crumbs[columnIndex + 1]?.id
        return (
          <Box
            key={String(crumb.id)}
            role="group"
            aria-label={crumb.name}
            sx={{
              width: 252,
              minWidth: 220,
              maxWidth: 320,
              flex: '0 0 252px',
              borderRight: 1,
              borderColor: 'divider',
              overflowY: 'auto',
              minHeight: 0,
              position: 'relative',
            }}
          >
            <List dense disablePadding sx={{ py: 0.5 }}>
              {state.items.map((item) => {
                const directory = item.kind === 'dir'
                const active = directory
                  ? String(nextCrumbID ?? '') === String(item.id)
                  : selected.has(String(item.id))
                return (
                  <ListItemButton
                    key={String(item.id)}
                    data-xdrive-file-explorer-item
                    data-xdrive-file-explorer-column-item
                    selected={active}
                    onClick={() => {
                      onSelect(item)
                      if (directory) {
                        void onNavigate([
                          ...crumbs.slice(0, columnIndex + 1),
                          { id: item.id, name: item.name },
                        ])
                      }
                    }}
                    onDoubleClick={() => {
                      if (!directory) onOpenFile(item)
                    }}
                    onContextMenu={(event) => onItemContextMenu?.(event, item)}
                    sx={{ minHeight: 30, py: 0.25, px: 1, gap: 0.75 }}
                  >
                    {directory
                      ? <FolderRoundedIcon sx={{ fontSize: 19, flexShrink: 0 }} />
                      : <InsertDriveFileRoundedIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
                    <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>{item.name}</Typography>
                    {directory ? <ChevronRightRoundedIcon sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} /> : null}
                  </ListItemButton>
                )
              })}
            </List>
            {state.nextCursor ? (
              <Stack sx={{ px: 1, pb: 1 }}>
                <XDriveAutoLoadSentinel
                  enabled
                  loading={false}
                  label="正在加载更多项目…"
                  onLoad={() => state.loading ? undefined : load(crumb.id, true)}
                />
              </Stack>
            ) : state.loaded && !state.error && state.items.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.25, py: 1 }}>空文件夹</Typography>
            ) : null}
            <ColumnNetworkFeedback loading={state.loading} generation={state.generation} />
            {state.error ? (
              <Box role="alert" data-xdrive-column-error sx={{
                position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 1, px: 1.25, py: 0.5, borderRadius: 1,
                bgcolor: 'background.paper', boxShadow: 2,
              }}>
                <Typography variant="caption" color="text.secondary">文件夹读取失败</Typography>
                <Button size="small" onClick={() => {
                  void load(crumb.id, state.loaded && Boolean(state.nextCursor)).catch(() => undefined)
                }}>重试</Button>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}
