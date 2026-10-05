import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
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
import type { XDriveFileExplorerQuickAccessEntry } from './FileExplorerQuickAccessController'
import type { XDriveFileExplorerRecentEntry } from './FileExplorerRecentController'

export type XDriveFileExplorerNavigationTreeCrumb = {
  id: number
  name: string
}

export type XDriveFileExplorerNavigationTreeDirectory = {
  id: number
  name: string
  type: string
}

type XDriveFileExplorerNavigationTreeNode = {
  id: number
  name: string
  crumbs: XDriveFileExplorerNavigationTreeCrumb[]
}

export function XDriveFileExplorerNavigationPane({
  currentCrumbs,
  loadDirectories,
  onNavigate,
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
  loadDirectories: (
    parentID: number,
  ) => Promise<readonly XDriveFileExplorerNavigationTreeDirectory[]>
  onNavigate: (crumbs: XDriveFileExplorerNavigationTreeCrumb[]) => void | Promise<void>
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
  const [childrenByParent, setChildrenByParent] = useState<Record<string, XDriveFileExplorerNavigationTreeNode[]>>({})
  const [expandedIDs, setExpandedIDs] = useState<Set<number>>(() => new Set())
  const [loadingIDs, setLoadingIDs] = useState<Set<number>>(() => new Set())
  const loadedIDsRef = useRef(new Set<number>())
  const loadingIDsRef = useRef(new Set<number>())

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

  const pathChildByParent = useMemo(() => {
    const next = new Map<number, XDriveFileExplorerNavigationTreeNode>()
    for (let index = 0; index < pathNodes.length - 1; index += 1) {
      next.set(pathNodes[index].id, pathNodes[index + 1])
    }
    return next
  }, [pathNodes])

  const childrenFor = useCallback((node: XDriveFileExplorerNavigationTreeNode) => {
    const loaded = childrenByParent[String(node.id)] ?? []
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
  }, [childrenByParent, pathChildByParent])

  const loadChildren = useCallback(async (node: XDriveFileExplorerNavigationTreeNode) => {
    if (loadedIDsRef.current.has(node.id) || loadingIDsRef.current.has(node.id)) return

    loadingIDsRef.current.add(node.id)
    setLoadingIDs((current) => new Set(current).add(node.id))
    try {
      const directories = await loadDirectories(node.id)
      setChildrenByParent((current) => ({
        ...current,
        [String(node.id)]: directories.map((directory) => ({
          id: directory.id,
          name: directory.name,
          crumbs: [...node.crumbs, { id: directory.id, name: directory.name }],
        })),
      }))
      loadedIDsRef.current.add(node.id)
    } catch (error) {
      onError?.(error)
    } finally {
      loadingIDsRef.current.delete(node.id)
      setLoadingIDs((current) => {
        const next = new Set(current)
        next.delete(node.id)
        return next
      })
    }
  }, [loadDirectories, onError])

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

  const renderNode = (node: XDriveFileExplorerNavigationTreeNode, depth: number) => {
    const children = childrenFor(node)
    const loaded = loadedIDsRef.current.has(node.id)
    const loading = loadingIDs.has(node.id)
    const expanded = expandedIDs.has(node.id)
    const expandable = !loaded || children.length > 0
    const selected = currentID === node.id

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
          {loading ? (
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
            }}
          >
            <FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d', flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {node.name}
            </Typography>
          </ListItemButton>
        </Box>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box role="group">
            {children.map((child) => renderNode(child, depth + 1))}
          </Box>
        </Collapse>
      </Box>
    )
  }

  const canPinCurrent = quickAccessEnabled && currentCrumbs.length > 1 && Boolean(onToggleCurrentQuickAccess)

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
                    selected={currentID === item.id}
                    title={item.path || item.name}
                    onClick={() => { void onNavigateQuickAccess?.(item.id) }}
                    sx={{ minWidth: 0, minHeight: 30, py: 0.25, px: 0.75, borderRadius: 1, gap: 0.75 }}
                  >
                    <FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d', flexShrink: 0 }} />
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
                  selected={item.kind === 'dir' && currentID === item.id}
                  title={item.path || item.name}
                  onClick={() => { void onActivateRecent?.(item.id) }}
                  sx={{ minWidth: 0, minHeight: 30, py: 0.25, px: 0.75, borderRadius: 1, gap: 0.75 }}
                >
                  {item.kind === 'dir'
                    ? <FolderRoundedIcon sx={{ fontSize: 18, color: '#ffcb3d', flexShrink: 0 }} />
                    : <InsertDriveFileRoundedIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
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
