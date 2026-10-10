import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import {
  Autocomplete, Box, Button, Drawer, IconButton, Menu, MenuItem,
  Slider, Stack, TextField, Typography,
} from '@mui/material'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'
import { xDriveMediaTimeZoneChoices } from '../media-timezone'

export type MobileGalleryTimeScale = 'year' | 'month' | 'day' | 'all'
export type MobileGalleryPrimaryTab = 'library' | 'collections'

export interface XDriveMobileGalleryChromeProps {
  primaryTab: MobileGalleryPrimaryTab
  onPrimaryTabChange: (tab: MobileGalleryPrimaryTab) => void
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
  onSearchRequested?: () => void
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
  // Only real shared Gallery actions may expose More on Collections overview.
  showOverviewActions?: boolean
  extraActions?: ReactNode
}

/**
 * Gallery-local controls only. The 52px XDriveMobileAppHeader owns exiting the
 * app, transfers and the single global app-switcher, and is never duplicated.
 */
export function XDriveMobileGalleryChrome({
  primaryTab, onPrimaryTabChange, collectionTitle, canGoBack, onGoBack,
  showCollection, selectionMode, onToggleSelection, sortBy, sortDir, onSort,
  filterContent, onSearchRequested, timeScale, onTimeScale, currentDateLabel, timeZone,
  onTimeZoneChange, aspectMode, onAspectModeChange, density, densityMin,
  densityMax, densityStep, onDensityChange, foldDuplicates,
  onFoldDuplicatesChange, jumpGroups, onJumpGroup, onJumpDay,
  canReturnToPosition, onReturnToPosition, onRefresh, showOverviewActions, extraActions,
}: XDriveMobileGalleryChromeProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [jumpDay, setJumpDay] = useState('')
  const searchHost = useRef<HTMLDivElement>(null)
  const panelViewport = useXDriveMobilePanelViewport(searchOpen || moreOpen)
  const collectionsOverview = primaryTab === 'collections' && !showCollection && !canGoBack
  const canShowMore = !collectionsOverview || Boolean(showOverviewActions)

  useEffect(() => {
    if (!searchOpen || !searchFocus) return
    // Focus the existing search input in the shared filter form. The Gallery
    // does not create another query state or duplicate a search request.
    const focusSearch = () => {
      searchHost.current?.querySelector<HTMLInputElement>('input[aria-label="搜索"]')?.focus()
    }
    if (typeof requestAnimationFrame !== 'function') {
      focusSearch()
      return
    }
    const frame = requestAnimationFrame(focusSearch)
    return () => cancelAnimationFrame(frame)
  }, [searchOpen, searchFocus])

  const openFilter = (focus: boolean) => {
    setSearchFocus(focus)
    setSearchOpen(true)
  }

  const closeSortMenu = () => {
    setSortAnchor(null)
    setViewOptionsOpen(false)
  }

  // Collections overview must never retain detached Library menu actions.
  useEffect(() => {
    if (!showCollection) {
      setSortAnchor(null)
      setViewOptionsOpen(false)
    }
  }, [showCollection])

  // If an authorized Collections action disappears, its open action sheet must
  // not outlive the visible trigger or retain a stale mutation affordance.
  useEffect(() => {
    if (!canShowMore) setMoreOpen(false)
  }, [canShowMore])

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
          {canGoBack || primaryTab === 'collections' ? (
            <Typography variant="body2" fontWeight={650} noWrap sx={{ minWidth: 0 }}>
              {canGoBack ? collectionTitle : '精选集'}
            </Typography>
          ) : null}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0}
          sx={{ flexShrink: 0, '& .MuiButton-root, & .MuiIconButton-root': { minHeight: 44, minWidth: 44 } }}>
          {showCollection ? (
            <>
              <Button size="small" aria-pressed={selectionMode}
                data-xdrive-mobile-gallery-select onClick={onToggleSelection}>
                {selectionMode ? '完成' : '选择'}
              </Button>
              <IconButton aria-label="图库排序和筛选"
                aria-haspopup="menu" aria-expanded={Boolean(sortAnchor)}
                onClick={(event) => {
                  setViewOptionsOpen(false)
                  setSortAnchor(event.currentTarget)
                }}
                data-xdrive-mobile-gallery-sort-filter>
                <SortRoundedIcon fontSize="small" />
              </IconButton>
            </>
          ) : null}
          {canShowMore ? (
            <IconButton aria-label="图库更多操作" aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)} data-xdrive-mobile-gallery-more
              sx={{ minWidth: 44, minHeight: 44 }}>
              <MoreHorizRoundedIcon />
            </IconButton>
          ) : null}
        </Stack>
      </Stack>


      <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)}
        onClose={closeSortMenu}
        aria-label={viewOptionsOpen ? '图库显示选项' : '图库排序和筛选'}>
        {showCollection && (viewOptionsOpen ? (
          <>
            <MenuItem data-xdrive-mobile-gallery-view-back
              onClick={() => setViewOptionsOpen(false)}
              sx={{ minHeight: 44, fontWeight: 650 }}>
              <ArrowBackRoundedIcon fontSize="small" sx={{ mr: 1 }} />
              排序和筛选
            </MenuItem>
            <MenuItem aria-label="放大照片缩略图" data-xdrive-mobile-gallery-zoom-in
              disabled={density <= densityMin}
              onClick={() => {
                onDensityChange(Math.max(densityMin, density - densityStep))
                closeSortMenu()
              }}
              sx={{ minHeight: 44 }}>放大</MenuItem>
            <MenuItem aria-label="缩小照片缩略图" data-xdrive-mobile-gallery-zoom-out
              disabled={density >= densityMax}
              onClick={() => {
                onDensityChange(Math.min(densityMax, density + densityStep))
                closeSortMenu()
              }}
              sx={{ minHeight: 44 }}>缩小</MenuItem>
            <MenuItem data-xdrive-mobile-gallery-aspect-crop
              selected={aspectMode === 'crop'}
              onClick={() => { onAspectModeChange('crop'); closeSortMenu() }}
              sx={{ minHeight: 44 }}>方形裁切</MenuItem>
            <MenuItem data-xdrive-mobile-gallery-aspect-contain
              selected={aspectMode === 'contain'}
              onClick={() => { onAspectModeChange('contain'); closeSortMenu() }}
              sx={{ minHeight: 44 }}>完整比例（方形网格）</MenuItem>
          </>
        ) : (
          <>
            {([
              ['captured', 'asc', '拍摄时间 · 最早在前'],
              ['captured', 'desc', '拍摄时间 · 最新在前'],
              ['added', 'asc', '加入时间 · 最早在前'],
              ['added', 'desc', '加入时间 · 最新在前'],
            ] as const).map(([by, dir, label]) => (
              <MenuItem key={by + dir} selected={sortBy === by && sortDir === dir}
                onClick={() => { onSort(by, dir); closeSortMenu() }}
                sx={{ minHeight: 44 }}>{label}</MenuItem>
            ))}
            <MenuItem data-xdrive-mobile-gallery-filter disabled={!filterContent}
              onClick={() => { closeSortMenu(); openFilter(false) }}
              sx={{ minHeight: 44 }}>筛选图库</MenuItem>
            <MenuItem data-xdrive-mobile-gallery-display-options
              onClick={() => setViewOptionsOpen(true)}
              sx={{ minHeight: 44 }}>显示选项</MenuItem>
          </>
        ))}
      </Menu>

      {!selectionMode && primaryTab === 'library' && showCollection ? (
        <Stack data-xdrive-mobile-gallery-time-scale
          direction="row" role="group" aria-label="图库时间尺度"
          justifyContent="center" spacing={0.5}
          sx={{
            // Photos' Years / Months / All live in the Gallery-local bottom
            // chrome, above the existing Library / Collections / Search dock.
            position: 'fixed', left: '50%', transform: 'translateX(-50%)',
            bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
            zIndex: 7, minHeight: 52, p: 0.5,
            maxWidth: 'calc(100vw - 24px)',
            borderRadius: 99, border: '1px solid', borderColor: 'divider',
            boxShadow: 2,
            backgroundColor: (theme) => theme.palette.mode === 'dark'
              ? 'rgba(37,37,41,0.84)' : 'rgba(250,250,252,0.84)',
            backdropFilter: 'blur(22px) saturate(1.45)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.45)',
            pointerEvents: 'auto',
          }}>
          {([
            ['year', '年'], ['month', '月'], ['all', '全部'],
          ] as const).map(([value, label]) => (
            <Button key={value} size="small"
              variant={timeScale === value ? 'contained' : 'text'}
              aria-pressed={timeScale === value}
              data-xdrive-mobile-gallery-scale={value}
              onClick={() => onTimeScale(value)}
              sx={{ minWidth: 58, minHeight: 44, borderRadius: 99 }}>
              {label}
            </Button>
          ))}
        </Stack>
      ) : null}

      {!selectionMode ? (
        <Stack data-xdrive-mobile-gallery-bottom direction="row"
          alignItems="center" justifyContent="space-between" spacing={0.75}
          sx={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 7,
            minHeight: 56, px: 1.5,
            pb: 'env(safe-area-inset-bottom, 0px)',
            boxSizing: 'content-box',
            bgcolor: 'transparent',
            pointerEvents: 'none',
          }}>
          <Stack direction="row" role="tablist" aria-label="照片主导航"
            spacing={0.25} data-xdrive-mobile-gallery-primary-tabs
            sx={{
              flex: 1, minWidth: 0, maxWidth: 288, py: 0.5, px: 0.5,
              borderRadius: 99, border: '1px solid',
              borderColor: 'divider', boxShadow: 2,
              backgroundColor: (theme) => theme.palette.mode === 'dark'
                ? 'rgba(37,37,41,0.84)' : 'rgba(250,250,252,0.84)',
              backdropFilter: 'blur(22px) saturate(1.45)',
              WebkitBackdropFilter: 'blur(22px) saturate(1.45)',
              pointerEvents: 'auto',
            }}>
            {([
              ['library', '图库'], ['collections', '精选集'],
            ] as const).map(([tab, label]) => (
              <Button key={tab} role="tab" size="small"
                aria-selected={primaryTab === tab}
                aria-controls="xdrive-mobile-gallery-main"
                data-xdrive-mobile-gallery-tab={tab}
                variant={primaryTab === tab ? 'contained' : 'text'}
                onClick={() => onPrimaryTabChange(tab)}
                sx={{ flex: 1, minWidth: 84, minHeight: 44, borderRadius: 99 }}>
                {label}
              </Button>
            ))}
          </Stack>
          <IconButton aria-label="搜索图库" disabled={!filterContent}
            onClick={() => { onSearchRequested?.(); openFilter(true) }}
            data-xdrive-mobile-gallery-search
            sx={{
              minWidth: 50, minHeight: 50, pointerEvents: 'auto',
              bgcolor: 'background.paper', border: '1px solid',
              borderColor: 'divider', boxShadow: 2,
              backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)',
            }}>
            <SearchRoundedIcon />
          </IconButton>
        </Stack>
      ) : null}

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
          {!collectionsOverview && currentDateLabel ? (
            <Typography variant="caption" color="text.secondary">
              当前浏览：{currentDateLabel}
            </Typography>
          ) : null}
          <Stack spacing={1.5} sx={{ py: 1.5 }}>
            {showCollection ? (
              <Button variant={timeScale === 'day' ? 'contained' : 'outlined'}
                data-xdrive-mobile-gallery-day-mode
                onClick={() => { onTimeScale('day'); setMoreOpen(false) }}>
                按日浏览
              </Button>
            ) : null}
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
            {!collectionsOverview && onTimeZoneChange ? (
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
            {!collectionsOverview ? (
              <>
                <Typography variant="caption" color="text.secondary">
                  照片墙最少列数：{density} 列
                </Typography>
                <Slider size="small" aria-label="移动图库缩略图密度"
                  valueLabelDisplay="auto"
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
              </>
            ) : null}
            {onRefresh ? <Button onClick={onRefresh}>刷新图库</Button> : null}
            {extraActions}
          </Stack>
        </Box>
      </Drawer>
    </>
  )
}
