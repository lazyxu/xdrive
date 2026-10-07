import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Box,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  ListItemButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  XDRIVE_FILE_EXPLORER_DRAG_MIME,
  xDriveFileExplorerDecodeDragIDs,
} from '../file-explorer-drag'
import { XDriveAutoLoadSentinel } from './AutoLoadSentinel'
import {
  xDriveFileExplorerReadExternalDrop,
} from './FileExplorerExternalDrop'
import type {
  XDriveFileExplorerExternalDropPayload,
} from './FileExplorerExternalDrop'
import type { XDriveFileExplorerQuickAccessEntry } from './FileExplorerQuickAccessController'
import type { XDriveFileExplorerRecentEntry } from './FileExplorerRecentController'
import { XDriveFileExplorerThumbnail } from './FileExplorerThumbnail'
import { xDriveFileSupportsThumbnail } from './FileExplorer'

export type XDriveFileExplorerNavigationTreeCrumb = {
  id: number
  name: string
}

export type XDriveFileExplorerNavigationTreeDirectory = {
  id: number
  name: string
  type: string
}

export type XDriveFileExplorerNavigationTreePage = {
  items: readonly XDriveFileExplorerNavigationTreeDirectory[]
  nextCursor: string
  hasMore: boolean
}

type XDriveFileExplorerNavigationTreeNode = {
  id: number
  name: string
  crumbs: XDriveFileExplorerNavigationTreeCrumb[]
}

export function XDriveFileExplorerNavigationPane({
  currentCrumbs,
  trashActive = false,
  onNavigateTrash,
  loadDirectoryPage,
  onNavigate,
  dropDisabled = false,
  onDropInternalItems,
  onExternalFilesDrop,
  onExternalFolderDrop,
  quickAccessEnabled = false,
  quickAccessItems = [],
  quickAccessLoading = false,
  quickAccessBusyID = null,
  currentQuickAccessPinned = false,
  onNavigateQuickAccess,
  onToggleCurrentQuickAccess,
  onUnpinQuickAccess,
  recentEnabled = false,
  recentItems = [],
  recentLoading = false,
  onActivateRecent,
  onClearRecent,
  onError,
}: {
  currentCrumbs: readonly XDriveFileExplorerNavigationTreeCrumb[]
  trashActive?: boolean
  onNavigateTrash?: () => void | Promise<void>
  loadDirectoryPage: (
    parentID: number,
    cursor?: string,
  ) => Promise<XDriveFileExplorerNavigationTreePage>
  onNavigate: (crumbs: XDriveFileExplorerNavigationTreeCrumb[]) => void | Promise<void>
  dropDisabled?: boolean
  onDropInternalItems?: (
    itemIDs: readonly (string | number)[],
    target: XDriveFileExplorerNavigationTreeCrumb,
    operation: 'move' | 'copy',
  ) => void | Promise<void>
  onExternalFilesDrop?: (
    files: File[],
    target: XDriveFileExplorerNavigationTreeCrumb,
  ) => void | Promise<void>
  onExternalFolderDrop?: (
    payload: XDriveFileExplorerExternalDropPayload,
    target: XDriveFileExplorerNavigationTreeCrumb,
  ) => void | Promise<void>
  quickAccessEnabled?: boolean
  quickAccessItems?: readonly XDriveFileExplorerQuickAccessEntry[]
  quickAccessLoading?: boolean
  quickAccessBusyID?: number | null
  currentQuickAccessPinned?: boolean
  onNavigateQuickAccess?: (nodeID: number) => void | Promise<void>
  onToggleCurrentQuickAccess?: () => void | Promise<void>
  onUnpinQuickAccess?: (nodeID: number) => void | Promise<void>
  recentEnabled?: boolean
  recentItems?: readonly XDriveFileExplorerRecentEntry[]
  recentLoading?: boolean
  onActivateRecent?: (nodeID: number) => void | Promise<void>
  onClearRecent?: () => void | Promise<void>
  onError?: (error: unknown) => void
}) {
  const [pageByParent, setPageByParent] = useState<Record<string, {
    children: XDriveFileExplorerNavigationTreeNode[]
    nextCursor: string
    hasMore: boolean
    loaded: boolean
    generation: number
  }>>({})
  const pageByParentRef = useRef(pageByParent)
  const [expandedIDs, setExpandedIDs] = useState<Set<number>>(() => new Set())
  const [loadingIDs, setLoadingIDs] = useState<Set<number>>(() => new Set())
  const loadingIDsRef = useRef(new Map<number, number>())
  const loadDirectoryPageRef = useRef(loadDirectoryPage)
  const loadDirectoryPageGenerationRef = useRef(1)
  if (loadDirectoryPageRef.current !== loadDirectoryPage) {
    loadDirectoryPageRef.current = loadDirectoryPage
    loadDirectoryPageGenerationRef.current += 1
  }
  const [dropTargetID, setDropTargetID] = useState<number | null>(null)

  const pathNodes = useMemo(
    () => currentCrumbs.map((crumb, index) => ({
      id: crumb.id,
      name: crumb.name,
      crumbs: currentCrumbs.slice(0, index + 1).map((entry) => ({ ...entry })),
    })),
    [currentCrumbs],
  )
  const currentID = currentCrumbs.at(-1)?.id
  const rootNode = pathNodes[0] ?? null
  const latestPathCrumbsByIDRef = useRef(
    new Map<number, XDriveFileExplorerNavigationTreeCrumb[]>(),
  )
  latestPathCrumbsByIDRef.current = new Map(
    pathNodes.map((node) => [
      node.id,
      node.crumbs.map((crumb) => ({ ...crumb })),
    ]),
  )

  const pathChildByParent = useMemo(() => {
    const next = new Map<number, XDriveFileExplorerNavigationTreeNode>()
    for (let index = 0; index < pathNodes.length - 1; index += 1) {
      next.set(pathNodes[index].id, pathNodes[index + 1])
    }
    return next
  }, [pathNodes])

  const childrenFor = useCallback((node: XDriveFileExplorerNavigationTreeNode) => {
    const loaded = pageByParent[String(node.id)]?.children ?? []
    const pathChild = pathChildByParent.get(node.id)
    if (!pathChild) return loaded

    let matched = false
    const merged = loaded.map((candidate) => {
      if (candidate.id !== pathChild.id) return candidate
      matched = true
      return pathChild
    })
    if (!matched) merged.push(pathChild)
    return merged.sort((left, right) => (
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    ))
  }, [pageByParent, pathChildByParent])

  const commitParentPage = useCallback((
    parentID: number,
    value: {
      children: XDriveFileExplorerNavigationTreeNode[]
      nextCursor: string
      hasMore: boolean
      loaded: boolean
      generation: number
    },
  ) => {
    const next = {
      ...pageByParentRef.current,
      [String(parentID)]: value,
    }
    pageByParentRef.current = next
    setPageByParent(next)
  }, [])

  const loadChildren = useCallback(async (
    node: XDriveFileExplorerNavigationTreeNode,
    append = false,
  ) => {
    const generation = loadDirectoryPageGenerationRef.current
    const current = pageByParentRef.current[String(node.id)]
    const appendCurrentGeneration = append && current?.generation === generation
    if (!append && current?.loaded && current.generation === generation) return
    if (
      appendCurrentGeneration &&
      (!current?.hasMore || !current.nextCursor)
    ) return
    if (loadingIDsRef.current.get(node.id) === generation) return

    loadingIDsRef.current.set(node.id, generation)
    setLoadingIDs((currentIDs) => new Set(currentIDs).add(node.id))
    try {
      const page = await loadDirectoryPage(
        node.id,
        appendCurrentGeneration ? current?.nextCursor : undefined,
      )
      if (generation !== loadDirectoryPageGenerationRef.current) return
      if (
        appendCurrentGeneration &&
        current?.nextCursor &&
        page.hasMore &&
        page.nextCursor === current.nextCursor
      ) {
        throw new Error('文件夹树分页游标重复。')
      }
      const merged = new Map<number, XDriveFileExplorerNavigationTreeNode>()
      if (appendCurrentGeneration && current) {
        for (const child of current.children) merged.set(child.id, child)
      }
      const latestNodeCrumbs =
        latestPathCrumbsByIDRef.current.get(node.id) ?? node.crumbs
      for (const directory of page.items) {
        merged.set(directory.id, {
          id: directory.id,
          name: directory.name,
          crumbs: [
            ...latestNodeCrumbs.map((crumb) => ({ ...crumb })),
            { id: directory.id, name: directory.name },
          ],
        })
      }
      commitParentPage(node.id, {
        children: [...merged.values()],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loaded: true,
        generation,
      })
    } catch (error) {
      if (generation === loadDirectoryPageGenerationRef.current) onError?.(error)
    } finally {
      if (loadingIDsRef.current.get(node.id) === generation) {
        loadingIDsRef.current.delete(node.id)
        setLoadingIDs((currentIDs) => {
          const next = new Set(currentIDs)
          next.delete(node.id)
          return next
        })
      }
    }
  }, [commitParentPage, loadDirectoryPage, onError])

  useEffect(() => {
    if (!rootNode) return
    const ancestors = pathNodes.slice(0, Math.max(1, pathNodes.length - 1))
    setExpandedIDs((current) => {
      const next = new Set(current)
      for (const node of ancestors) next.add(node.id)
      return next
    })
    for (const node of ancestors) void loadChildren(node)
  }, [loadChildren, pathNodes, rootNode])

  const toggleExpanded = (node: XDriveFileExplorerNavigationTreeNode) => {
    const expanded = expandedIDs.has(node.id)
    setExpandedIDs((current) => {
      const next = new Set(current)
      if (expanded) next.delete(node.id)
      else next.add(node.id)
      return next
    })
    if (!expanded) void loadChildren(node)
  }

  const dragOverNode = (
    event: ReactDragEvent<HTMLElement>,
    node: XDriveFileExplorerNavigationTreeNode,
  ) => {
    if (dropDisabled) return
    const types = Array.from(event.dataTransfer.types)
    const internal = types.includes(XDRIVE_FILE_EXPLORER_DRAG_MIME) &&
      Boolean(onDropInternalItems)
    const external = types.includes('Files') &&
      Boolean(onExternalFilesDrop || onExternalFolderDrop)
    if (!internal && !external) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = internal && (event.ctrlKey || event.metaKey)
      ? 'copy'
      : external ? 'copy' : 'move'
    setDropTargetID(node.id)
  }

  const leaveDropTarget = (
    event: ReactDragEvent<HTMLElement>,
    nodeID: number,
  ) => {
    const related = event.relatedTarget
    if (
      related instanceof Node &&
      event.currentTarget.contains(related)
    ) return
    setDropTargetID((current) => current === nodeID ? null : current)
  }

  const dropOnNode = async (
    event: ReactDragEvent<HTMLElement>,
    node: XDriveFileExplorerNavigationTreeNode,
  ) => {
    if (dropDisabled) return
    event.preventDefault()
    event.stopPropagation()
    const dataTransfer = event.dataTransfer
    const target = { id: node.id, name: node.name }
    try {
      if (dataTransfer.types.includes('Files')) {
        if (onExternalFolderDrop) {
          const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
          if (payload.directories.length > 0) {
            await onExternalFolderDrop(payload, target)
            return
          }
        }
        const droppedFiles = Array.from(dataTransfer.files)
        if (droppedFiles.length > 0 && onExternalFilesDrop) {
          await onExternalFilesDrop(droppedFiles, target)
          return
        }
      }

      if (onDropInternalItems) {
        const itemIDs = xDriveFileExplorerDecodeDragIDs(
          dataTransfer.getData(XDRIVE_FILE_EXPLORER_DRAG_MIME),
        )
        if (itemIDs.length > 0) {
          await onDropInternalItems(
            itemIDs,
            target,
            event.ctrlKey || event.metaKey ? 'copy' : 'move',
          )
        }
      }
    } finally {
      setDropTargetID(null)
    }
  }

  const renderNode = (node: XDriveFileExplorerNavigationTreeNode, depth: number) => {
    const children = childrenFor(node)
    const page = pageByParent[String(node.id)]
    const loaded = Boolean(page?.loaded)
    const hasMore = Boolean(page?.hasMore)
    const loading = loadingIDs.has(node.id)
    const expanded = expandedIDs.has(node.id)
    const expandable = !loaded || children.length > 0 || hasMore
    const selected = !trashActive && currentID === node.id

    return (
      <Box
        key={node.id}
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
        aria-current={selected ? 'page' : undefined}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '26px minmax(0, 1fr)',
            alignItems: 'center',
            pl: 0.5 + depth * 1.75,
            pr: 0.5,
            minHeight: 32,
          }}
        >
          {loading && !loaded ? (
            <Box sx={{ width: 26, height: 30, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={13} />
            </Box>
          ) : expandable ? (
            <IconButton
              size="small"
              aria-label={expanded ? `折叠 ${node.name}` : `展开 ${node.name}`}
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded(node)
              }}
              sx={{ width: 26, height: 28, borderRadius: 1 }}
            >
              {expanded
                ? <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
                : <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          ) : (
            <Box sx={{ width: 26, height: 28 }} />
          )}

          <ListItemButton
            selected={selected}
            aria-label={node.name}
            onDragOver={(event) => dragOverNode(event, node)}
            onDragLeave={(event) => leaveDropTarget(event, node.id)}
            onDrop={(event) => { void dropOnNode(event, node) }}
            onClick={() => {
              if (!selected) void onNavigate(node.crumbs)
            }}
            sx={{
              minWidth: 0,
              minHeight: 30,
              py: 0.25,
              px: 0.75,
              borderRadius: 1,
              gap: 0.75,
              bgcolor: dropTargetID === node.id ? 'action.hover' : undefined,
              outline: dropTargetID === node.id ? '2px solid' : undefined,
              outlineColor: dropTargetID === node.id ? 'primary.main' : undefined,
              outlineOffset: -2,
            }}
          >
            <Box sx={{ width: 20, height: 20, flex: '0 0 20px' }}>
              <XDriveFileExplorerThumbnail
                item={{ id: node.id, name: node.name, kind: 'dir' }}
                eligible={false}
                fallback={<FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d' }} />}
              />
            </Box>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {node.name}
            </Typography>
          </ListItemButton>
        </Box>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box role="group">
            {children.map((child) => renderNode(child, depth + 1))}
            {hasMore ? (
              <Box
                data-xdrive-file-explorer-tree-auto-load
                sx={{
                  ml: 0.5 + (depth + 1) * 1.75,
                  mr: 0.5,
                }}
              >
                <XDriveAutoLoadSentinel
                  enabled
                  loading={loading}
                  label="正在加载更多文件夹…"
                  onLoad={() => loadChildren(node, true)}
                />
              </Box>
            ) : null}
          </Box>
        </Collapse>
      </Box>
    )
  }

  const canPinCurrent = !trashActive && quickAccessEnabled && currentCrumbs.length > 1 && Boolean(onToggleCurrentQuickAccess)

  return (
    <Box
      data-xdrive-file-explorer-navigation-tree
      aria-label="文件夹导航"
      sx={{
        width: 232,
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
        py: 0.75,
        bgcolor: 'background.paper',
      }}
    >
      {onNavigateTrash ? (
        <>
          <Box component="nav" aria-label="回收站" sx={{ px: 0.75, pb: 0.75 }}>
            <ListItemButton
              selected={trashActive}
              aria-current={trashActive ? 'page' : undefined}
              onClick={() => { void onNavigateTrash() }}
              sx={{ minWidth: 0, minHeight: 32, py: 0.25, px: 0.75, borderRadius: 1, gap: 0.75 }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 19, color: trashActive ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
              <Typography variant="body2" noWrap sx={{ minWidth: 0, fontWeight: trashActive ? 600 : 400 }}>
                回收站
              </Typography>
            </ListItemButton>
          </Box>
          <Divider sx={{ mb: 0.75 }} />
        </>
      ) : null}

      {quickAccessEnabled ? (
        <Box component="nav" aria-label="快速访问" sx={{ px: 0.75, pb: 0.75 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 30, pl: 0.75 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              快速访问
            </Typography>
            {canPinCurrent ? (
              <Tooltip title={currentQuickAccessPinned ? '取消固定当前文件夹' : '固定当前文件夹'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={currentQuickAccessPinned ? '取消固定当前文件夹' : '固定当前文件夹'}
                    disabled={quickAccessBusyID !== null}
                    onClick={() => { void onToggleCurrentQuickAccess?.() }}
                    sx={{ width: 26, height: 26, borderRadius: 1 }}
                  >
                    <PushPinRoundedIcon
                      sx={{
                        fontSize: 16,
                        transform: currentQuickAccessPinned ? 'none' : 'rotate(45deg)',
                        opacity: currentQuickAccessPinned ? 1 : 0.65,
                      }}
                    />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>

          {quickAccessLoading && quickAccessItems.length === 0 ? (
            <Box sx={{ minHeight: 32, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={14} />
            </Box>
          ) : quickAccessItems.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
              暂无固定文件夹
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {quickAccessItems.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 28px',
                    alignItems: 'center',
                  }}
                >
                  <ListItemButton
                    selected={!trashActive && currentID === item.id}
                    title={item.path || item.name}
                    onClick={() => { void onNavigateQuickAccess?.(item.id) }}
                    sx={{ minWidth: 0, minHeight: 30, py: 0.25, px: 0.75, borderRadius: 1, gap: 0.75 }}
                  >
                    <Box sx={{ width: 20, height: 20, flex: '0 0 20px' }}>
                      <XDriveFileExplorerThumbnail
                        item={{ id: item.id, name: item.name, kind: 'dir', path: item.path }}
                        eligible={false}
                        fallback={<FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d' }} />}
                      />
                    </Box>
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {item.name}
                    </Typography>
                  </ListItemButton>
                  <Tooltip title="取消固定">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`取消固定 ${item.name}`}
                        disabled={quickAccessBusyID !== null}
                        onClick={() => { void onUnpinQuickAccess?.(item.id) }}
                        sx={{ width: 26, height: 26, borderRadius: 1 }}
                      >
                        <CloseRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {quickAccessEnabled ? <Divider sx={{ mb: 0.75 }} /> : null}

      {recentEnabled ? (
        <Box component="nav" aria-label="最近使用" sx={{ px: 0.75, pb: 0.75 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 30, pl: 0.75 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <HistoryRoundedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                最近使用
              </Typography>
            </Stack>
            {recentItems.length > 0 && onClearRecent ? (
              <Tooltip title="清空最近使用">
                <span>
                  <IconButton
                    size="small"
                    aria-label="清空最近使用"
                    disabled={recentLoading}
                    onClick={() => { void onClearRecent() }}
                    sx={{ width: 26, height: 26, borderRadius: 1 }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>

          {recentLoading && recentItems.length === 0 ? (
            <Box sx={{ minHeight: 32, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={14} />
            </Box>
          ) : recentItems.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
              暂无最近访问
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {recentItems.slice(0, 8).map((item) => (
                <ListItemButton
                  key={item.id}
                  selected={!trashActive && item.kind === 'dir' && currentID === item.id}
                  title={item.path || item.name}
                  onClick={() => { void onActivateRecent?.(item.id) }}
                  sx={{ minWidth: 0, minHeight: 30, py: 0.25, px: 0.75, borderRadius: 1, gap: 0.75 }}
                >
                  <Box sx={{ width: 22, height: 22, flex: '0 0 22px', overflow: 'hidden', borderRadius: 0.75 }}>
                    <XDriveFileExplorerThumbnail
                      item={{
                        id: item.id,
                        name: item.name,
                        kind: item.kind,
                        size: item.size,
                        revision: item.revision,
                        updatedAt: item.updatedAt,
                        path: item.path,
                      }}
                      eligible={item.kind === 'file' && xDriveFileSupportsThumbnail(item.name, 'file')}
                      fallback={item.kind === 'dir'
                        ? <FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d' }} />
                        : <InsertDriveFileRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />}
                    />
                  </Box>
                  <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                    {item.name}
                  </Typography>
                </ListItemButton>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {recentEnabled ? <Divider sx={{ mb: 0.75 }} /> : null}

      <Box role="tree" aria-label="文件夹树">
        {rootNode ? renderNode(rootNode, 0) : null}
      </Box>
    </Box>
  )
}
