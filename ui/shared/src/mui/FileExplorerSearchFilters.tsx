import { useMemo, useState } from 'react'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import {
  Chip,
  Menu,
  MenuItem,
  Stack,
} from '@mui/material'
import type { MouseEvent } from 'react'
import type {
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerSearchKind,
  XDriveFileExplorerSearchSourceOption,
} from '../file-explorer-search'
import {
  xDriveFileExplorerSearchFilterCount,
} from '../file-explorer-search'

type FilterMenu = 'kind' | 'modified' | 'size' | 'source'

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
  onChange,
}: {
  filters: XDriveFileExplorerSearchFilters
  sourceOptions?: readonly XDriveFileExplorerSearchSourceOption[]
  onChange: (filters: XDriveFileExplorerSearchFilters) => void
}) {
  const [menu, setMenu] = useState<FilterMenu | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const filterCount = xDriveFileExplorerSearchFilterCount(filters)
  const sourceName = useMemo(
    () => sourceOptions.find((item) => item.id === filters.sourceID)?.name,
    [filters.sourceID, sourceOptions],
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
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <FilterAltOutlinedIcon fontSize="small" color={filterCount > 0 ? 'primary' : 'action'} />
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
        <Chip
          size="small"
          variant={filters.sourceID ? 'filled' : 'outlined'}
          color={filters.sourceID ? 'primary' : 'default'}
          label={filters.sourceID ? `同步文件夹：${sourceName ?? filters.sourceID}` : '同步文件夹'}
          onClick={open('source')}
          onDelete={filters.sourceID ? () => onChange({ ...filters, sourceID: undefined }) : undefined}
        />
        {filterCount > 1 ? (
          <Chip
            size="small"
            variant="outlined"
            label="清除筛选"
            onClick={() => onChange({})}
          />
        ) : null}
      </Stack>

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
    </>
  )
}
