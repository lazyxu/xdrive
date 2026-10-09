import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import {
  Autocomplete, Box, Button, Drawer, IconButton, Menu, MenuItem,
  Slider, Stack, TextField, Typography,
} from '@mui/material'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'
import { XDriveMediaGalleryNavigation } from './MediaGalleryNavigation'
import type { MediaGallerySection } from './MediaGalleryNavigation'
import { xDriveMediaTimeZoneChoices } from '../media-timezone'

export type MobileGalleryTimeScale = 'year' | 'month' | 'day' | 'all'

export interface XDriveMobileGalleryChromeProps {
  section: MediaGallerySection
  onSectionChange?: (section: MediaGallerySection) => void
  collectionTitle: string
  canGoBack: boolean
  onGoBack?: () => void
  showCollection: boolean
  selectionMode: boolean
  onToggleSelection: () => void
  sortBy: 'captured' | 'added'
  sortDir: 'asc' | 'desc'
  onSort: (by: 'captured' | 'added', dir: 'asc' | 'desc') => void
  filterContent?: ReactNode
  timeScale: MobileGalleryTimeScale
  onTimeScale: (scale: MobileGalleryTimeScale) => void
  currentDateLabel?: string
  timeZone: string
  onTimeZoneChange?: (zone: string) => void
  aspectMode: 'crop' | 'contain'
  onAspectModeChange: (mode: 'crop' | 'contain') => void
  density: number
  densityMin: number
  densityMax: number
  densityStep: number
  onDensityChange: (value: number) => void
  foldDuplicates?: boolean
  onFoldDuplicatesChange?: (enabled: boolean) => void
  jumpGroups?: readonly { key: string; label: string }[]
  onJumpGroup?: (key: string) => void
  onJumpDay?: (day: string) => void
  canReturnToPosition?: boolean
  onReturnToPosition?: () => void
  onRefresh?: () => void
  extraActions?: ReactNode
}

/**
 * Gallery-local controls only. The 52px XDriveMobileAppHeader owns exiting the
 * app, transfers and the single global app-switcher, and is never duplicated.
 */
export function XDriveMobileGalleryChrome({
  section, onSectionChange, collectionTitle, canGoBack, onGoBack,
  showCollection, selectionMode, onToggleSelection, sortBy, sortDir, onSort,
  filterContent, timeScale, onTimeScale, currentDateLabel, timeZone,
  onTimeZoneChange, aspectMode, onAspectModeChange, density, densityMin,
  densityMax, densityStep, onDensityChange, foldDuplicates,
  onFoldDuplicatesChange, jumpGroups, onJumpGroup, onJumpDay,
  canReturnToPosition, onReturnToPosition, onRefresh, extraActions,
}: XDriveMobileGalleryChromeProps) {
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [jumpDay, setJumpDay] = useState('')
  const searchHost = useRef<HTMLDivElement>(null)
  const panelViewport = useXDriveMobilePanelViewport(searchOpen || categoryOpen || moreOpen)

  useEffect(() => {
    if (!searchOpen || !searchFocus) return
    // Focus the existing search input in the shared filter form. The Gallery
    // does not create another query state or duplicate a search request.
    const frame = requestAnimationFrame(() => {
      searchHost.current?.querySelector<HTMLInputElement>('input[aria-label="搜索"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [searchOpen, searchFocus])

  const openFilter = (focus: boolean) => {
    setSearchFocus(focus)
    setSearchOpen(true)
  }

  const sheetSx = (maxHeight: string) => ({
    maxHeight: panelViewport ? panelViewport.height + 'px' : '100dvh',
    height: panelViewport ? 'min(' + maxHeight + ', ' + panelViewport.height + 'px)' : maxHeight,
    bottom: panelViewport ? panelViewport.bottom + 'px' : undefined,
    minHeight: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  } as const)

  return (
    <>
      <Stack data-xdrive-mobile-gallery-actions direction="row" alignItems="center"
        justifyContent="space-between" spacing={0.25}
        sx={{
          position: 'sticky', top: 0, zIndex: 6, minHeight: 48,
          bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
          mx: -0.5, px: 0.5, flexShrink: 0,
        }}>
        <Stack direction="row" alignItems="center" spacing={0.25}
          sx={{ flex: 1, minWidth: 0 }}>
          {canGoBack && onGoBack ? (
            <IconButton aria-label="图库内部返回上一级" onClick={onGoBack}
              sx={{ minWidth: 44, minHeight: 44 }}>
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {canGoBack ? (
            <Typography variant="body2" fontWeight={650} noWrap sx={{ minWidth: 0 }}>
              {collectionTitle}
            </Typography>
          ) : null}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0}
          sx={{ flexShrink: 0, '& .MuiButton-root, & .MuiIconButton-root': { minHeight: 44, minWidth: 44 } }}>
          <Button size="small" disabled={!showCollection}
            aria-pressed={selectionMode} data-xdrive-mobile-gallery-select
            onClick={onToggleSelection}>
            {selectionMode ? '完成' : '选择'}
          </Button>
          <IconButton aria-label="图库排序" disabled={!showCollection}
            onClick={(event) => setSortAnchor(event.currentTarget)}
            data-xdrive-mobile-gallery-sort>
            <SortRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="图库筛选" disabled={!filterContent}
            onClick={() => openFilter(false)} data-xdrive-mobile-gallery-filter>
            <FilterAltOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="图库更多操作"
            onClick={() => setMoreOpen(true)} data-xdrive-mobile-gallery-more>
            <MoreHorizRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)}
        onClose={() => setSortAnchor(null)} aria-label="图库排序方式">
        {([
          ['captured', 'asc', '拍摄时间 · 最早在前'],
          ['captured', 'desc', '拍摄时间 · 最新在前'],
          ['added', 'asc', '加入时间 · 最早在前'],
          ['added', 'desc', '加入时间 · 最新在前'],
        ] as const).map(([by, dir, label]) => (
          <MenuItem key={by + dir} selected={sortBy === by && sortDir === dir}
            onClick={() => { onSort(by, dir); setSortAnchor(null) }}
            sx={{ minHeight: 44 }}>{label}</MenuItem>
        ))}
      </Menu>

      {!selectionMode ? (
        <Stack data-xdrive-mobile-gallery-bottom direction="row"
          alignItems="center" justifyContent="space-between" spacing={0.25}
          sx={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 7,
            minHeight: 56, px: 1,
            pb: 'env(safe-area-inset-bottom, 0px)',
            borderTop: 1, borderColor: 'divider',
            bgcolor: 'background.paper',
            boxSizing: 'content-box',
          }}>
          <Button size="small" aria-label="图库分类" onClick={() => setCategoryOpen(true)}
            data-xdrive-mobile-gallery-category sx={{ minWidth: 54, minHeight: 44 }}>
            分类
          </Button>
          <Stack direction="row" spacing={0} role="group" aria-label="图库时间尺度"
            sx={{ minWidth: 0, flex: '0 1 auto', '& .MuiButton-root': {
              minWidth: 35, minHeight: 44, px: 0.6, borderRadius: 99,
            } }}>
            {([
              ['year', '年'], ['month', '月'], ['day', '日'], ['all', '全部'],
            ] as const).map(([value, label]) => (
              <Button key={value} size="small"
                variant={timeScale === value ? 'contained' : 'text'}
                aria-pressed={timeScale === value} disabled={!showCollection}
                data-xdrive-mobile-gallery-scale={value}
                onClick={() => onTimeScale(value)}>{label}</Button>
            ))}
          </Stack>
          <IconButton aria-label="搜索图库" disabled={!filterContent}
            onClick={() => openFilter(true)} data-xdrive-mobile-gallery-search
            sx={{ minWidth: 44, minHeight: 44 }}>
            <SearchRoundedIcon />
          </IconButton>
        </Stack>
      ) : null}

      <Drawer anchor="bottom" open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        slotProps={{ paper: { sx: sheetSx('min(52dvh, 460px)') } }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ p: 2, pb: 1 }}>
          图库分类
        </Typography>
        <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1,
          pb: 'env(safe-area-inset-bottom, 0px)' }}>
          {onSectionChange ? (
            <XDriveMediaGalleryNavigation value={section} layout="drawer"
              onChange={(next) => { onSectionChange(next); setCategoryOpen(false) }} />
          ) : null}
        </Box>
      </Drawer>

      <Drawer anchor="bottom" open={searchOpen}
        onClose={() => setSearchOpen(false)}
        slotProps={{ paper: { sx: sheetSx('min(84dvh, 720px)') } }}>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, minHeight: 52 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
            {searchFocus ? '搜索图库' : '筛选图库'}
          </Typography>
          <Button onClick={() => setSearchOpen(false)} sx={{ minHeight: 44 }}>完成</Button>
        </Stack>
        <Box ref={searchHost} data-xdrive-mobile-gallery-filter-panel
          sx={{ flex: 1, minHeight: 0, p: 1, overflow: 'hidden',
            pb: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
          {filterContent}
        </Box>
      </Drawer>

      <Drawer anchor="bottom" open={moreOpen} onClose={() => setMoreOpen(false)}
        slotProps={{ paper: { sx: sheetSx('min(85dvh, 740px)') } }}>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, minHeight: 52 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
            图库设置与操作
          </Typography>
          <Button onClick={() => setMoreOpen(false)} sx={{ minHeight: 44 }}>完成</Button>
        </Stack>
        <Box data-xdrive-mobile-gallery-more-panel sx={{
          flex: 1, minHeight: 0, overflowY: 'auto', px: 2,
          pb: 'max(16px, env(safe-area-inset-bottom, 0px))',
        }}>
          {currentDateLabel ? (
            <Typography variant="caption" color="text.secondary">
              当前浏览：{currentDateLabel}
            </Typography>
          ) : null}
          <Stack spacing={1.5} sx={{ py: 1.5 }}>
            {canReturnToPosition && onReturnToPosition ? (
              <Button variant="outlined" onClick={() => { onReturnToPosition(); setMoreOpen(false) }}>
                返回刚才位置
              </Button>
            ) : null}
            {showCollection && jumpGroups && jumpGroups.length > 1 && onJumpGroup ? (
              <TextField select size="small" label="跳转年月" value=""
                onChange={(event) => {
                  onJumpGroup(event.target.value)
                  setMoreOpen(false)
                }}>
                <MenuItem value="">跳转年月</MenuItem>
                {jumpGroups.map((group) => (
                  <MenuItem key={group.key} value={group.key}>{group.label}</MenuItem>
                ))}
              </TextField>
            ) : null}
            {showCollection && onJumpDay ? (
              <TextField type="date" size="small" label="跳转日期" value={jumpDay}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => {
                  setJumpDay(event.target.value)
                  if (event.target.value) {
                    onJumpDay(event.target.value)
                    setMoreOpen(false)
                  }
                }}
              />
            ) : null}
            {onTimeZoneChange ? (
              <Autocomplete freeSolo size="small"
                options={xDriveMediaTimeZoneChoices()} value={timeZone}
                onChange={(_event, value) => {
                  if (typeof value === 'string') onTimeZoneChange(value)
                }}
                renderInput={(params) => (
                  <TextField {...params} label="日期时区" aria-label="移动图库日期时区" />
                )}
              />
            ) : null}
            <Typography variant="caption" color="text.secondary">
              照片显示方式
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button variant={aspectMode === 'crop' ? 'contained' : 'outlined'}
                onClick={() => onAspectModeChange('crop')}>方形裁切</Button>
              <Button variant={aspectMode === 'contain' ? 'contained' : 'outlined'}
                onClick={() => onAspectModeChange('contain')}>完整比例</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              照片墙密度
            </Typography>
            <Slider size="small" aria-label="移动图库缩略图密度"
              min={densityMin} max={densityMax} step={densityStep}
              value={density} onChange={(_event, value) => {
                if (typeof value === 'number') onDensityChange(value)
              }} />
            {onFoldDuplicatesChange ? (
              <Button variant={foldDuplicates ? 'contained' : 'outlined'}
                onClick={() => onFoldDuplicatesChange(!foldDuplicates)}>
                {foldDuplicates ? '取消折叠重复副本' : '折叠重复副本'}
              </Button>
            ) : null}
            {onRefresh ? <Button onClick={onRefresh}>刷新图库</Button> : null}
            {extraActions}
          </Stack>
        </Box>
      </Drawer>
    </>
  )
}
