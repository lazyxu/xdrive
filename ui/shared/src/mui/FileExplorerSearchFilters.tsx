import { useMemo, useState } from 'react'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import {
  Box,
  Button,
  Chip,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Typography,
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
} from '../file-explorer-search'

type FilterMenu = 'kind' | 'modified' | 'size' | 'availability' | 'source' | 'tag'

const kindLabels: Record<XDriveFileExplorerSearchKind, string> = {
  folder: '文件夹',
  file: '全部文件',
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  document: '文档',
  spreadsheet: '表格',
  presentation: '演示文稿',
  archive: '压缩文件',
  code: '代码',
  text: '文本',
  other: '其他文件',
}

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

function sizeLabel(filters: XDriveFileExplorerSearchFilters) {
  const min = filters.minSize
  const max = filters.maxSize
  if (min === undefined && max === undefined) return '大小'
  if (min === 0 && max === (1 << 20) - 1) return '大小：< 1 MiB'
  if (min === 1 << 20 && max === (100 << 20) - 1) return '大小：1–100 MiB'
  if (min === 100 << 20 && max === (1 << 30) - 1) return '大小：100 MiB–1 GiB'
  if (min === 1 << 30 && max === undefined) return '大小：≥ 1 GiB'
  return '大小：已筛选'
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
  const [panelAnchor, setPanelAnchor] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState<FilterMenu | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const filterCount = xDriveFileExplorerSearchFilterCount(filters)
  const sourceName = useMemo(
    () => sourceOptions.find((item) => item.id === filters.sourceID)?.name,
    [filters.sourceID, sourceOptions],
  )
  const availabilityName = useMemo(
    () => availabilityOptions.find((item) => item.value === filters.availability)?.label,
    [availabilityOptions, filters.availability],
  )
  const tagName = useMemo(
    () => tagOptions.find((item) => item.id === filters.tagID)?.name,
    [filters.tagID, tagOptions],
  )

  const open = (next: FilterMenu) => (event: MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget)
    setMenu(next)
  }
  const close = () => {
    setAnchor(null)
    setMenu(null)
  }
  const patch = (value: Partial<XDriveFileExplorerSearchFilters>) => {
    onChange({ ...filters, ...value })
    close()
  }

  return (
    <>
      <Button
        size="small"
        variant={filterCount > 0 ? 'outlined' : 'text'}
        startIcon={<FilterAltOutlinedIcon fontSize="small" />}
        aria-label="筛选文件"
        aria-haspopup="dialog"
        aria-expanded={Boolean(panelAnchor)}
        onClick={(event) => setPanelAnchor(event.currentTarget)}
        sx={{ whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {filterCount > 0 ? `筛选 (${filterCount})` : '筛选'}
      </Button>
      <Popover
        open={Boolean(panelAnchor)}
        anchorEl={panelAnchor}
        onClose={() => setPanelAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box
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
                  onClick={() => {
                    setPanelAnchor(null)
                    onSaveSearch()
                  }}
                >
                  保存搜索
                </Button>
              ) : null}
              {filterCount > 0 ? (
                <Button size="small" onClick={() => onChange({})}>清除全部</Button>
              ) : null}
            </Stack>
          </Stack>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
            <Chip
              size="small"
              variant={filters.kind ? 'filled' : 'outlined'}
              color={filters.kind ? 'primary' : 'default'}
              label={filters.kind ? `类型：${kindLabels[filters.kind]}` : '类型'}
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
            {availabilityOptions.length > 0 ? (
              <Chip
                size="small"
                variant={filters.availability ? 'filled' : 'outlined'}
                color={filters.availability ? 'primary' : 'default'}
                label={filters.availability ? `可用性：${availabilityName ?? filters.availability}` : '可用性'}
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
              label={filters.sourceID ? `同步文件夹：${sourceName ?? filters.sourceID}` : '同步文件夹'}
              onClick={open('source')}
              onDelete={filters.sourceID ? () => onChange({ ...filters, sourceID: undefined }) : undefined}
            />
            {tagOptions.length > 0 ? (
              <Chip
                size="small"
                variant={filters.tagID ? 'filled' : 'outlined'}
                color={filters.tagID ? 'primary' : 'default'}
                label={filters.tagID ? `标签：${tagName ?? filters.tagID}` : '标签'}
                onClick={open('tag')}
                onDelete={filters.tagID ? () => onChange({ ...filters, tagID: undefined }) : undefined}
              />
            ) : null}
          </Stack>
        </Box>
      </Popover>

      <Menu anchorEl={anchor} open={menu === 'kind'} onClose={close}>
        <MenuItem onClick={() => patch({ kind: undefined })}>全部类型</MenuItem>
        {(Object.entries(kindLabels) as Array<[XDriveFileExplorerSearchKind, string]>).map(([kind, label]) => (
          <MenuItem key={kind} selected={filters.kind === kind} onClick={() => patch({ kind })}>
            {label}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={anchor} open={menu === 'modified'} onClose={close}>
        <MenuItem onClick={() => patch({ modifiedFrom: undefined, modifiedTo: undefined })}>不限时间</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(), modifiedTo: undefined })}>今天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(7), modifiedTo: undefined })}>最近 7 天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfDayISO(30), modifiedTo: undefined })}>最近 30 天</MenuItem>
        <MenuItem onClick={() => patch({ modifiedFrom: startOfYearISO(), modifiedTo: undefined })}>今年</MenuItem>
      </Menu>

      <Menu anchorEl={anchor} open={menu === 'size'} onClose={close}>
        <MenuItem onClick={() => patch({ minSize: undefined, maxSize: undefined })}>不限大小</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 0, maxSize: (1 << 20) - 1 })}>小于 1 MiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 1 << 20, maxSize: (100 << 20) - 1 })}>1–100 MiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 100 << 20, maxSize: (1 << 30) - 1 })}>100 MiB–1 GiB</MenuItem>
        <MenuItem onClick={() => patch({ minSize: 1 << 30, maxSize: undefined })}>1 GiB 及以上</MenuItem>
      </Menu>

      <Menu anchorEl={anchor} open={menu === 'availability'} onClose={close}>
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

      <Menu anchorEl={anchor} open={menu === 'source'} onClose={close}>
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

      <Menu anchorEl={anchor} open={menu === 'tag'} onClose={close}>
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
