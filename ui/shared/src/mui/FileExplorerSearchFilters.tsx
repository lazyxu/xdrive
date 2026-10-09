import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Badge,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { MouseEvent } from 'react'
import type {
  XDriveFileExplorerSearchAvailabilityOption,
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerSearchKind,
  XDriveFileExplorerSearchSourceOption,
  XDriveFileExplorerSearchTagOption,
} from '../file-explorer-search'
import {
  xDriveFileExplorerSearchFilterCount,
  xDriveFileExplorerSearchFilterFieldLabels,
  xDriveFileExplorerSearchKindLabels as kindLabels,
  xDriveFileExplorerSearchSizeLabel as sizeLabel,
} from '../file-explorer-search'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'

type FilterMenu = 'kind' | 'modified' | 'size' | 'availability' | 'source' | 'tag'

function startOfDayISO(daysAgo = 0) {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() - daysAgo)
  return value.toISOString()
}

function startOfYearISO() {
  const value = new Date()
  value.setMonth(0, 1)
  value.setHours(0, 0, 0, 0)
  return value.toISOString()
}

export function XDriveFileExplorerSearchFilters({
  filters,
  sourceOptions = [],
  tagOptions = [],
  availabilityOptions = [],
  canSaveSearch = false,
  onSaveSearch,
  onChange,
}: {
  filters: XDriveFileExplorerSearchFilters
  sourceOptions?: readonly XDriveFileExplorerSearchSourceOption[]
  tagOptions?: readonly XDriveFileExplorerSearchTagOption[]
  availabilityOptions?: readonly XDriveFileExplorerSearchAvailabilityOption[]
  canSaveSearch?: boolean
  onSaveSearch?: () => void
  onChange: (filters: XDriveFileExplorerSearchFilters) => void
}) {
  const compactViewport = useMediaQuery('(max-width:899.95px)')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [panelAnchor, setPanelAnchor] = useState<HTMLElement | null>(null)
  const [panelCompactViewport, setPanelCompactViewport] = useState(compactViewport)
  const [menu, setMenu] = useState<FilterMenu | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const panelOpen = Boolean(panelAnchor) && panelCompactViewport === compactViewport
  const panelViewport = useXDriveMobilePanelViewport(compactViewport && panelOpen)
  const filterCount = xDriveFileExplorerSearchFilterCount(filters)
  const filterLabels = useMemo(
    () => xDriveFileExplorerSearchFilterFieldLabels(filters, { sourceOptions, tagOptions, availabilityOptions }),
    [filters, sourceOptions, tagOptions, availabilityOptions],
  )

  const open = (next: FilterMenu) => (event: MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget)
    setMenu(next)
  }
  const close = useCallback(() => {
    setAnchor(null)
    setMenu(null)
  }, [])
  const closePanel = useCallback(() => {
    close()
    setPanelAnchor(null)
  }, [close])
  useEffect(() => {
    if (!panelAnchor || panelCompactViewport === compactViewport) return
    closePanel()
    triggerRef.current?.focus()
  }, [closePanel, compactViewport, panelAnchor, panelCompactViewport])

  const menuAvailable = (menu !== 'tag' || tagOptions.length > 0 || Boolean(filters.tagID)) &&
    (menu !== 'availability' || availabilityOptions.length > 0 || Boolean(filters.availability))
  const menuOpen = panelOpen && menuAvailable && Boolean(anchor?.isConnected)
  useEffect(() => {
    if (menu && !menuOpen) close()
  }, [close, menu, menuOpen])

  const patch = (value: Partial<XDriveFileExplorerSearchFilters>) => {
    onChange({ ...filters, ...value })
    close()
  }
  const openPanel = (event: MouseEvent<HTMLElement>) => {
    setPanelCompactViewport(compactViewport)
    setPanelAnchor(event.currentTarget)
  }
  const saveSearch = () => {
    if (!canSaveSearch || !onSaveSearch) return
    closePanel()
    onSaveSearch()
  }
  const clearFilters = () => {
    if (filterCount === 0) return
    close()
    onChange({})
  }
  const mobileField = (
    field: FilterMenu,
    label: string,
    value: string,
    active: boolean,
    cleared: Partial<XDriveFileExplorerSearchFilters>,
  ) => (
    <Stack direction="row" spacing={1} alignItems="stretch">
      <Button
        fullWidth
        variant={active ? 'contained' : 'outlined'}
        aria-haspopup="menu"
        aria-expanded={menuOpen && menu === field}
        endIcon={<ExpandMoreRoundedIcon />}
        onClick={open(field)}
        sx={{
          minWidth: 0,
          minHeight: 44,
          justifyContent: 'space-between',
          textAlign: 'left',
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          '& .MuiButton-endIcon': { flexShrink: 0 },
        }}
      >
        {value}
      </Button>
      {active ? (
        <IconButton
          aria-label={`清除${label}`}
          onClick={() => patch(cleared)}
          sx={{ width: 44, height: 44, flex: '0 0 44px', alignSelf: 'center' }}
        >
          <CloseRoundedIcon />
        </IconButton>
      ) : null}
    </Stack>
  )
  const menuProps = {
    anchorEl: menuOpen ? anchor : null,
    onClose: close,
    disableRestoreFocus: !panelOpen,
    slotProps: { paper: { sx: compactViewport ? {
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: panelViewport ? Math.max(0, panelViewport.height - 32) + 'px' : 'calc(100vh - 32px)',
      '@supports (height: 100dvh)': panelViewport ? {} : { maxHeight: 'calc(100dvh - 32px)' },
      '& .MuiMenuItem-root': { minHeight: 44, whiteSpace: 'normal', overflowWrap: 'anywhere' },
    } : undefined } },
  }

  return (
    <>
      {compactViewport ? (
        <IconButton
          ref={triggerRef}
          aria-label="筛选文件"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          color={filterCount > 0 ? 'primary' : 'default'}
          onClick={openPanel}
          sx={{ width: 44, height: 44, flex: '0 0 44px' }}
        >
          <Badge badgeContent={filterCount} color="primary">
            <FilterAltOutlinedIcon />
          </Badge>
        </IconButton>
      ) : (
      <Button
        ref={triggerRef}
        size="small"
        variant={filterCount > 0 ? 'outlined' : 'text'}
        startIcon={<FilterAltOutlinedIcon fontSize="small" />}
        aria-label="筛选文件"
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        onClick={openPanel}
        sx={{ whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {filterCount > 0 ? `筛选 (${filterCount})` : '筛选'}
      </Button>
      )}
      {compactViewport ? (
        <Drawer
          anchor="bottom"
          open={panelOpen}
          onClose={closePanel}
          slotProps={{ paper: {
            role: 'dialog',
            'aria-label': '文件筛选',
            'aria-modal': true,
            sx: {
              bottom: panelViewport ? panelViewport.bottom + 'px' : undefined,
              maxHeight: panelViewport
                ? panelViewport.height + 'px'
                : 'calc(100vh - env(safe-area-inset-top, 0px))',
              '@supports (height: 100dvh)': panelViewport ? {} : {
                maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px))',
              },
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            },
          } }}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexShrink: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" component="h2" fontWeight={700}>筛选</Typography>
              <Typography variant="body2" color="text.secondary">全部文件</Typography>
            </Box>
            <IconButton aria-label="关闭筛选" onClick={closePanel} sx={{ width: 44, height: 44, flex: '0 0 44px' }}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Stack
            spacing={1}
            data-xdrive-file-explorer-search-filters
            sx={{ p: 1.5, minHeight: 0, flex: '1 1 auto', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {mobileField('kind', '类型', filterLabels.kind, Boolean(filters.kind), { kind: undefined })}
            {mobileField('modified', '修改时间', filterLabels.modified, Boolean(filters.modifiedFrom || filters.modifiedTo), { modifiedFrom: undefined, modifiedTo: undefined })}
            {mobileField('size', '大小', filterLabels.size, filters.minSize !== undefined || filters.maxSize !== undefined, { minSize: undefined, maxSize: undefined })}
            {availabilityOptions.length > 0 || filters.availability ? mobileField('availability', '可用性', filterLabels.availability, Boolean(filters.availability), { availability: undefined }) : null}
            {mobileField('source', '同步文件夹', filterLabels.source, Boolean(filters.sourceID), { sourceID: undefined })}
            {tagOptions.length > 0 || filters.tagID ? mobileField('tag', '标签', filterLabels.tag, Boolean(filters.tagID), { tagID: undefined }) : null}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              p: 1.5,
              pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
              flexShrink: 0,
              borderTop: 1,
              borderColor: 'divider',
              '& .MuiButton-root': { minHeight: 44, minWidth: 0, flex: 1, whiteSpace: 'normal' },
            }}
          >
            {onSaveSearch ? (
              <Button startIcon={<BookmarkAddOutlinedIcon />} disabled={!canSaveSearch} onClick={saveSearch}>
                保存搜索
              </Button>
            ) : null}
            <Button disabled={filterCount === 0} onClick={clearFilters}>清除全部</Button>
          </Stack>
        </Drawer>
      ) : (
      <Popover
        open={panelOpen}
        anchorEl={panelOpen ? panelAnchor : null}
        onClose={closePanel}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box
          role="dialog"
          aria-label="文件筛选"
          data-xdrive-file-explorer-search-filters
          sx={{ p: 1.25, width: 'min(360px, calc(100vw - 32px))' }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">筛选</Typography>
            <Stack direction="row" spacing={0.5}>
              {onSaveSearch ? (
                <Button
                  size="small"
                  startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
                  disabled={!canSaveSearch}
                  onClick={saveSearch}
                >
                  保存搜索
                </Button>
              ) : null}
              {filterCount > 0 ? (
                <Button size="small" onClick={clearFilters}>清除全部</Button>
              ) : null}
              <IconButton size="small" aria-label="关闭筛选" onClick={closePanel}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
            <Chip
              size="small"
              variant={filters.kind ? 'filled' : 'outlined'}
              color={filters.kind ? 'primary' : 'default'}
              label={filterLabels.kind}
              onClick={open('kind')}
              onDelete={filters.kind ? () => onChange({ ...filters, kind: undefined }) : undefined}
            />
            <Chip
              size="small"
              variant={filters.modifiedFrom || filters.modifiedTo ? 'filled' : 'outlined'}
              color={filters.modifiedFrom || filters.modifiedTo ? 'primary' : 'default'}
              label={filters.modifiedFrom || filters.modifiedTo ? '修改时间：已筛选' : '修改时间'}
              onClick={open('modified')}
              onDelete={filters.modifiedFrom || filters.modifiedTo
                ? () => onChange({ ...filters, modifiedFrom: undefined, modifiedTo: undefined })
                : undefined}
            />
            <Chip
              size="small"
              variant={filters.minSize !== undefined || filters.maxSize !== undefined ? 'filled' : 'outlined'}
              color={filters.minSize !== undefined || filters.maxSize !== undefined ? 'primary' : 'default'}
              label={sizeLabel(filters)}
              onClick={open('size')}
              onDelete={filters.minSize !== undefined || filters.maxSize !== undefined
                ? () => onChange({ ...filters, minSize: undefined, maxSize: undefined })
                : undefined}
            />
            {availabilityOptions.length > 0 || filters.availability ? (
              <Chip
                size="small"
                variant={filters.availability ? 'filled' : 'outlined'}
                color={filters.availability ? 'primary' : 'default'}
                label={filterLabels.availability}
                onClick={open('availability')}
                onDelete={filters.availability
                  ? () => onChange({ ...filters, availability: undefined })
                  : undefined}
              />
            ) : null}
            <Chip
              size="small"
              variant={filters.sourceID ? 'filled' : 'outlined'}
              color={filters.sourceID ? 'primary' : 'default'}
              label={filterLabels.source}
              onClick={open('source')}
              onDelete={filters.sourceID ? () => onChange({ ...filters, sourceID: undefined }) : undefined}
            />
            {tagOptions.length > 0 || filters.tagID ? (
              <Chip
                size="small"
                variant={filters.tagID ? 'filled' : 'outlined'}
                color={filters.tagID ? 'primary' : 'default'}
                label={filterLabels.tag}
                onClick={open('tag')}
                onDelete={filters.tagID ? () => onChange({ ...filters, tagID: undefined }) : undefined}
              />
            ) : null}
          </Stack>
        </Box>
      </Popover>
      )}

      <Menu {...menuProps} open={menuOpen && menu === 'kind'}>
        <MenuItem onClick={() => patch({ kind: undefined })}>全部类型</MenuItem>
        {(Object.entries(kindLabels) as Array<[XDriveFileExplorerSearchKind, string]>).map(([kind, label]) => (
          <MenuItem key={kind} selected={filters.kind === kind} onClick={() => patch({ kind })}>
            {label}
          </MenuItem>
        ))}
      </Menu>

      <Menu {...menuProps} open={menuOpen && menu === 'modified'}>
        <MenuItem onClick={() => patch({ modifiedFrom: undefined, modifiedTo: undefined })}>不限时间</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(), modifiedTo: undefined })}>今天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(7), modifiedTo: undefined })}>最近 7 天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(30), modifiedTo: undefined })}>最近 30 天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfYearISO(), modifiedTo: undefined })}>今年</MenuItem>
      </Menu>

      <Menu {...menuProps} open={menuOpen && menu === 'size'}>
        <MenuItem onClick={() => patch({ minSize: undefined, maxSize: undefined })}>不限大小</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 0, maxSize: (1 << 20) - 1 })}>小于 1 MiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 1 << 20, maxSize: (100 << 20) - 1 })}>1–100 MiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 100 << 20, maxSize: (1 << 30) - 1 })}>100 MiB–1 GiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 1 << 30, maxSize: undefined })}>1 GiB 及以上</MenuItem>
      </Menu>

      <Menu {...menuProps} open={menuOpen && menu === 'availability'}>
        <MenuItem onClick={() => patch({ availability: undefined })}>全部可用性</MenuItem>
        {availabilityOptions.map((option) => (
          <MenuItem
            key={option.value}
            selected={filters.availability === option.value}
            onClick={() => patch({ availability: option.value })}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>

      <Menu {...menuProps} open={menuOpen && menu === 'source'}>
        <MenuItem onClick={() => patch({ sourceID: undefined })}>全部同步文件夹</MenuItem>
        {sourceOptions.map((source) => (
          <MenuItem
            key={source.id}
            selected={filters.sourceID === source.id}
            onClick={() => patch({ sourceID: source.id })}
          >
            {source.name}
          </MenuItem>
        ))}
        {sourceOptions.length === 0 ? <MenuItem disabled>暂无同步文件夹</MenuItem> : null}
      </Menu>

      <Menu {...menuProps} open={menuOpen && menu === 'tag'}>
        <MenuItem onClick={() => patch({ tagID: undefined })}>全部标签</MenuItem>
        {tagOptions.map((tag) => (
          <MenuItem
            key={tag.id}
            selected={filters.tagID === tag.id}
            onClick={() => patch({ tagID: tag.id })}
            sx={{ gap: 1 }}
          >
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: tag.color || 'text.disabled', flexShrink: 0 }} />
            {tag.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
