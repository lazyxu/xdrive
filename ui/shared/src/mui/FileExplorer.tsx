import { Fragment, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import {
  Box,
  Breadcrumbs,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { formatSize } from '../format'
import { XDriveStatePanel } from './StatePanel'

export type XDriveFileExplorerID = string | number
export type XDriveFileExplorerViewMode = 'details' | 'grid'
export type XDriveFileExplorerSortKey = 'name' | 'updated' | 'type' | 'size'
export type XDriveFileExplorerSortDirection = 'asc' | 'desc'

export type XDriveFileExplorerCrumb = {
  id: XDriveFileExplorerID
  name: string
}

export type XDriveFileExplorerItem = {
  id: XDriveFileExplorerID
  name: string
  kind: 'dir' | 'file'
  size?: number
  updatedAt?: string
  typeLabel?: string
  secondaryLabel?: string
  icon?: ReactNode
  thumbnail?: ReactNode
}

export type XDriveFileExplorerSort = {
  key: XDriveFileExplorerSortKey
  direction: XDriveFileExplorerSortDirection
}

export type XDriveFileExplorerMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  dividerBefore?: boolean
  onSelect: () => void
}

function explorerIDKey(id: XDriveFileExplorerID) {
  return `${typeof id}:${String(id)}`
}

export function XDriveFileExplorer({
  items,
  crumbs,
  loading = false,
  emptyMessage = '此文件夹为空',
  pathValue,
  onPathSubmit,
  searchValue = '',
  onSearchValueChange,
  onSearch,
  canGoBack = false,
  canGoForward = false,
  canGoUp = false,
  onBack,
  onForward,
  onUp,
  onRefresh,
  onCrumbClick,
  onCreateFolder,
  onUpload,
  onItemClick,
  onOpenItem,
  selectedIDs: controlledSelectedIDs,
  defaultSelectedIDs = [],
  onSelectionChange,
  getItemMenuItems,
  backgroundMenuItems = [],
  viewMode: controlledViewMode,
  onViewModeChange,
  sort: controlledSort,
  onSortChange,
  commandBarStart,
  commandBarEnd,
  statusText,
}: {
  items: XDriveFileExplorerItem[]
  crumbs: XDriveFileExplorerCrumb[]
  loading?: boolean
  emptyMessage?: string
  pathValue?: string
  onPathSubmit?: (path: string) => void
  searchValue?: string
  onSearchValueChange?: (value: string) => void
  onSearch?: (value: string) => void
  canGoBack?: boolean
  canGoForward?: boolean
  canGoUp?: boolean
  onBack?: () => void
  onForward?: () => void
  onUp?: () => void
  onRefresh?: () => void
  onCrumbClick?: (crumb: XDriveFileExplorerCrumb, index: number) => void
  onCreateFolder?: () => void
  onUpload?: () => void
  onItemClick?: (item: XDriveFileExplorerItem) => void
  onOpenItem?: (item: XDriveFileExplorerItem) => void
  selectedIDs?: readonly XDriveFileExplorerID[]
  defaultSelectedIDs?: readonly XDriveFileExplorerID[]
  onSelectionChange?: (ids: XDriveFileExplorerID[]) => void
  getItemMenuItems?: (item: XDriveFileExplorerItem) => XDriveFileExplorerMenuItem[]
  backgroundMenuItems?: XDriveFileExplorerMenuItem[]
  viewMode?: XDriveFileExplorerViewMode
  onViewModeChange?: (mode: XDriveFileExplorerViewMode) => void
  sort?: XDriveFileExplorerSort
  onSortChange?: (sort: XDriveFileExplorerSort) => void
  commandBarStart?: ReactNode
  commandBarEnd?: ReactNode
  statusText?: ReactNode
}) {
  const [editingPath, setEditingPath] = useState(false)
  const derivedPath = useMemo(
    () => pathValue ?? crumbs.map((crumb) => crumb.name).join('/'),
    [crumbs, pathValue],
  )
  const [pathDraft, setPathDraft] = useState(derivedPath)
  const [internalViewMode, setInternalViewMode] = useState<XDriveFileExplorerViewMode>('details')
  const [internalSort, setInternalSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const [internalSelectedIDs, setInternalSelectedIDs] = useState<XDriveFileExplorerID[]>([...defaultSelectedIDs])
  const [selectionAnchorID, setSelectionAnchorID] = useState<XDriveFileExplorerID | null>(null)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number
    mouseY: number
    items: XDriveFileExplorerMenuItem[]
  } | null>(null)

  const viewMode = controlledViewMode ?? internalViewMode
  const sort = controlledSort ?? internalSort
  const selectedIDs = controlledSelectedIDs ?? internalSelectedIDs
  const selectedKeySet = useMemo(
    () => new Set(selectedIDs.map(explorerIDKey)),
    [selectedIDs],
  )

  useEffect(() => {
    if (!editingPath) setPathDraft(derivedPath)
  }, [derivedPath, editingPath])

  const visibleItems = useMemo(() => {
    const result = [...items]
    const multiplier = sort.direction === 'asc' ? 1 : -1
    result.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
      if (sort.key === 'size') return ((left.size ?? 0) - (right.size ?? 0)) * multiplier
      if (sort.key === 'updated') {
        const leftTime = left.updatedAt ? Date.parse(left.updatedAt) || 0 : 0
        const rightTime = right.updatedAt ? Date.parse(right.updatedAt) || 0 : 0
        return (leftTime - rightTime) * multiplier
      }
      if (sort.key === 'type') {
        return (left.typeLabel ?? left.kind).localeCompare(right.typeLabel ?? right.kind, undefined, { numeric: true }) * multiplier
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) * multiplier
    })
    return result
  }, [items, sort.direction, sort.key])

  const commitSelection = (ids: XDriveFileExplorerID[]) => {
    if (controlledSelectedIDs === undefined) setInternalSelectedIDs(ids)
    onSelectionChange?.(ids)
  }

  const clearSelection = () => {
    setSelectionAnchorID(null)
    commitSelection([])
  }

  const selectItem = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
    index: number,
  ) => {
    const itemKey = explorerIDKey(item.id)
    const additive = event.ctrlKey || event.metaKey

    if (event.shiftKey && selectionAnchorID !== null) {
      const anchorKey = explorerIDKey(selectionAnchorID)
      const anchorIndex = visibleItems.findIndex((candidate) => explorerIDKey(candidate.id) === anchorKey)
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        const range = visibleItems.slice(start, end + 1).map((candidate) => candidate.id)
        if (additive) {
          const merged = new Map(selectedIDs.map((id) => [explorerIDKey(id), id]))
          for (const id of range) merged.set(explorerIDKey(id), id)
          commitSelection([...merged.values()])
        } else {
          commitSelection(range)
        }
        onItemClick?.(item)
        return
      }
    }

    if (additive) {
      if (selectedKeySet.has(itemKey)) {
        commitSelection(selectedIDs.filter((id) => explorerIDKey(id) !== itemKey))
      } else {
        commitSelection([...selectedIDs, item.id])
      }
    } else {
      commitSelection([item.id])
    }
    setSelectionAnchorID(item.id)
    onItemClick?.(item)
  }

  const toggleKeyboardSelection = (item: XDriveFileExplorerItem) => {
    const key = explorerIDKey(item.id)
    if (selectedKeySet.has(key)) {
      commitSelection(selectedIDs.filter((id) => explorerIDKey(id) !== key))
    } else {
      commitSelection([...selectedIDs, item.id])
    }
    setSelectionAnchorID(item.id)
  }

  const openItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedKeySet.has(explorerIDKey(item.id))) {
      commitSelection([item.id])
      setSelectionAnchorID(item.id)
    }
    const menuItems = getItemMenuItems?.(item) ?? []
    if (menuItems.length === 0) return
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      items: menuItems,
    })
  }

  const openBackgroundContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (backgroundMenuItems.length === 0) return
    event.preventDefault()
    clearSelection()
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      items: backgroundMenuItems,
    })
  }

  const contextMenuItems = contextMenu?.items ?? []

  const setViewMode = (mode: XDriveFileExplorerViewMode) => {
    if (controlledViewMode === undefined) setInternalViewMode(mode)
    onViewModeChange?.(mode)
  }

  const setSort = (next: XDriveFileExplorerSort) => {
    if (controlledSort === undefined) setInternalSort(next)
    onSortChange?.(next)
    setSortAnchor(null)
  }

  const submitPath = () => {
    const next = pathDraft.trim()
    setEditingPath(false)
    if (next && next !== derivedPath) onPathSubmit?.(next)
  }

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitPath()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setPathDraft(derivedPath)
      setEditingPath(false)
    }
  }

  const submitSearch = () => onSearch?.(searchValue.trim())

  const defaultTypeLabel = (item: XDriveFileExplorerItem) => (
    item.kind === 'dir' ? '文件夹' : item.typeLabel || '文件'
  )

  const defaultItemIcon = (item: XDriveFileExplorerItem, large = false) => (
    item.icon ?? (
      item.kind === 'dir'
        ? <FolderRoundedIcon sx={{ fontSize: large ? 52 : 22, color: 'warning.main' }} />
        : <InsertDriveFileRoundedIcon sx={{ fontSize: large ? 48 : 21, color: 'text.secondary' }} />
    )
  )

  const itemKeyDown = (event: KeyboardEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenItem?.(item)
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      toggleKeyboardSelection(item)
    }
  }

  const selectedSize = useMemo(
    () => items.reduce((total, item) => (
      selectedKeySet.has(explorerIDKey(item.id)) && item.kind === 'file'
        ? total + (item.size ?? 0)
        : total
    ), 0),
    [items, selectedKeySet],
  )

  return (
    <Paper
      variant="outlined"
      data-xdrive-file-explorer
      sx={{
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ px: 1.25, py: 1, minWidth: 0 }}
      >
        <Tooltip title="后退">
          <span>
            <IconButton size="small" aria-label="后退" disabled={!canGoBack} onClick={onBack}>
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="前进">
          <span>
            <IconButton size="small" aria-label="前进" disabled={!canGoForward} onClick={onForward}>
              <ArrowForwardRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="上一级">
          <span>
            <IconButton size="small" aria-label="上一级" disabled={!canGoUp} onClick={onUp}>
              <ArrowUpwardRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="刷新">
          <span>
            <IconButton size="small" aria-label="刷新" disabled={!onRefresh || loading} onClick={onRefresh}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 120 }}>
          {editingPath && onPathSubmit ? (
            <TextField
              fullWidth
              autoFocus
              size="small"
              aria-label="文件路径"
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={handlePathKeyDown}
              onBlur={submitPath}
              slotProps={{ htmlInput: { spellCheck: false } }}
            />
          ) : (
            <Paper
              variant="outlined"
              role={onPathSubmit ? 'button' : undefined}
              tabIndex={onPathSubmit ? 0 : undefined}
              aria-label="文件路径"
              onClick={() => {
                if (onPathSubmit) setEditingPath(true)
              }}
              onKeyDown={(event) => {
                if (onPathSubmit && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  setEditingPath(true)
                }
              }}
              sx={{
                minHeight: 40,
                px: 1,
                display: 'flex',
                alignItems: 'center',
                minWidth: 0,
                cursor: onPathSubmit ? 'text' : 'default',
                bgcolor: 'background.default',
                '&:focus-visible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                },
              }}
            >
              <Breadcrumbs
                maxItems={6}
                separator={<NavigateNextRoundedIcon sx={{ fontSize: 15 }} />}
                aria-label="面包屑路径"
                sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
              >
                {crumbs.map((crumb, index) => (
                  <ButtonBase
                    key={crumb.id}
                    disabled={index === crumbs.length - 1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCrumbClick?.(crumb, index)
                    }}
                    sx={{
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 1,
                      maxWidth: 180,
                      color: index === crumbs.length - 1 ? 'text.primary' : 'text.secondary',
                      fontSize: 13,
                      justifyContent: 'flex-start',
                    }}
                  >
                    <Typography variant="body2" noWrap>{crumb.name}</Typography>
                  </ButtonBase>
                ))}
              </Breadcrumbs>
            </Paper>
          )}
        </Box>

        <TextField
          size="small"
          value={searchValue}
          onChange={(event) => onSearchValueChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitSearch()
            }
          }}
          placeholder="搜索"
          aria-label="搜索文件和文件夹"
          sx={{ width: { xs: 150, sm: 220, lg: 300 }, flexShrink: 0 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="搜索" onClick={submitSearch}>
                    <SearchRoundedIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      <Divider />

      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ px: 1.25, py: 0.75, minHeight: 44 }}
      >
        {onCreateFolder ? (
          <Button size="small" startIcon={<CreateNewFolderRoundedIcon />} onClick={onCreateFolder}>
            新建文件夹
          </Button>
        ) : null}
        {onUpload ? (
          <Button size="small" startIcon={<UploadRoundedIcon />} onClick={onUpload}>
            上传
          </Button>
        ) : null}
        {commandBarStart}

        <Box sx={{ flex: 1 }} />

        {commandBarEnd}

        <Button
          size="small"
          startIcon={<SortRoundedIcon />}
          onClick={(event) => setSortAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(sortAnchor)}
        >
          排序
        </Button>
        <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
          {([
            ['name', '名称'],
            ['updated', '修改时间'],
            ['type', '类型'],
            ['size', '大小'],
          ] as const).map(([key, label]) => (
            <MenuItem
              key={key}
              selected={sort.key === key}
              onClick={() => setSort({
                key,
                direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
              })}
            >
              {label}{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </MenuItem>
          ))}
        </Menu>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewMode}
          onChange={(_event, next: XDriveFileExplorerViewMode | null) => {
            if (next) setViewMode(next)
          }}
          aria-label="文件查看方式"
        >
          <ToggleButton value="details" aria-label="详细信息">
            <ViewListRoundedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="grid" aria-label="图标">
            <GridViewRoundedIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Divider />

      <Box
        sx={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}
        tabIndex={0}
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (!target.closest('[data-xdrive-file-explorer-item]')) clearSelection()
        }}
        onContextMenu={openBackgroundContextMenu}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault()
            commitSelection(visibleItems.map((item) => item.id))
          }
          if (event.key === 'Escape') clearSelection()
        }}
      >
        {loading && visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" loading message="正在加载文件…" />
        ) : visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" message={emptyMessage} />
        ) : viewMode === 'details' ? (
          <Box role="table" aria-label="文件列表" sx={{ minWidth: 620 }}>
            <Box
              role="row"
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 120px',
                minHeight: 34,
                alignItems: 'center',
                px: 1.5,
                bgcolor: 'background.paper',
                borderBottom: 1,
                borderColor: 'divider',
                color: 'text.secondary',
                fontSize: 12,
              }}
            >
              <span role="columnheader">名称</span>
              <span role="columnheader">修改时间</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">大小</span>
            </Box>
            {visibleItems.map((item, index) => {
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              return (
              <ButtonBase
                key={item.id}
                component="div"
                role="row"
                data-xdrive-file-explorer-item
                tabIndex={0}
                aria-selected={selected}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => onOpenItem?.(item)}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 120px',
                  minHeight: 42,
                  alignItems: 'center',
                  px: 1.5,
                  textAlign: 'left',
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: selected ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" minWidth={0} role="cell">
                  {defaultItemIcon(item)}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{item.name}</Typography>
                    {item.secondaryLabel ? (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {item.secondaryLabel}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}
                </Typography>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {defaultTypeLabel(item)}
                </Typography>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {item.kind === 'dir' ? '—' : formatSize(item.size ?? 0)}
                </Typography>
              </ButtonBase>
              )
            })}
          </Box>
        ) : (
          <Box
            role="list"
            aria-label="文件图标"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 1,
              p: 1.25,
              alignContent: 'start',
            }}
          >
            {visibleItems.map((item, index) => {
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              return (
              <ButtonBase
                key={item.id}
                component="div"
                role="listitem"
                data-xdrive-file-explorer-item
                tabIndex={0}
                aria-selected={selected}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => onOpenItem?.(item)}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  minWidth: 0,
                  minHeight: 116,
                  maxWidth: 180,
                  borderRadius: 1.5,
                  p: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  gap: 0.75,
                  textAlign: 'center',
                  bgcolor: selected ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 72,
                    height: 64,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    borderRadius: 1,
                  }}
                >
                  {item.thumbnail ?? defaultItemIcon(item, true)}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    width: '100%',
                    overflowWrap: 'anywhere',
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                    lineHeight: 1.25,
                  }}
                >
                  {item.name}
                </Typography>
              </ButtonBase>
              )
            })}
          </Box>
        )}

        {loading && visibleItems.length > 0 ? (
          <Box
            aria-label="正在刷新文件"
            sx={{
              position: 'absolute',
              inset: '0 0 auto',
              height: 2,
              bgcolor: 'primary.main',
              opacity: 0.55,
            }}
          />
        ) : null}
      </Box>

      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {contextMenuItems.map((menuItem) => (
          <Fragment key={menuItem.id}>
            {menuItem.dividerBefore ? <Divider /> : null}
            <MenuItem
              disabled={menuItem.disabled}
              onClick={() => {
                setContextMenu(null)
                menuItem.onSelect()
              }}
              sx={menuItem.danger ? { color: 'error.main' } : undefined}
            >
              {menuItem.icon ? <Box sx={{ mr: 1, display: 'flex' }}>{menuItem.icon}</Box> : null}
              {menuItem.label}
            </MenuItem>
          </Fragment>
        ))}
      </Menu>

      <Divider />

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ minHeight: 32, px: 1.5, color: 'text.secondary' }}
      >
        <Typography variant="caption">
          {items.length} 个项目{selectedIDs.length > 0 ? ` · 已选择 ${selectedIDs.length} 个` : ''}
        </Typography>
        <Typography variant="caption">
          {statusText ?? (selectedIDs.length > 0 && selectedSize > 0 ? `已选择 ${formatSize(selectedSize)}` : '')}
        </Typography>
      </Stack>
    </Paper>
  )
}
