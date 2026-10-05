import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { Box, CircularProgress, Collapse, IconButton, ListItemButton, Typography } from '@mui/material'

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
  onError,
}: {
  currentCrumbs: readonly XDriveFileExplorerNavigationTreeCrumb[]
  loadDirectories: (
    parentID: number,
  ) => Promise<readonly XDriveFileExplorerNavigationTreeDirectory[]>
  onNavigate: (crumbs: XDriveFileExplorerNavigationTreeCrumb[]) => void | Promise<void>
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

  return (
    <Box
      data-xdrive-file-explorer-navigation-tree
      aria-label="文件夹导航"
      role="tree"
      sx={{
        width: 232,
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
        py: 0.75,
        bgcolor: 'background.paper',
      }}
    >
      {rootNode ? renderNode(rootNode, 0) : null}
    </Box>
  )
}
