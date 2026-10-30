import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { XDRIVE_MOBILE_ITEM_HOLD_MS, xDriveMobileItemMoved } from '../../ui/shared/src/mobile-item-gesture'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import BackupRoundedIcon from '@mui/icons-material/BackupRounded'
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import {
  BottomNavigation, BottomNavigationAction, Box, Button, ButtonBase, Drawer,
  IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Stack, TextField, Typography,
} from '@mui/material'
import type { XDriveSidebarDestinationModel, XDriveSidebarSectionModel } from '@xdrive/ui/mui'
import type { XDriveWebAppRoute } from '../../ui/shared/src'
import type { XDriveMobileSlot } from './mobileFiveSlotState'
import { XDRIVE_WEB_APPS } from './webApps'

/** Browser-local icon choices, canonical labels from existing Web descriptors.
 * Do not pull Desktop-only JSX navigation modules into the Web bundle. */
function xDriveBrowserMobileDestinationIcon(key: string): ReactNode {
  switch (key) {
    case 'files': return <FolderOpenRoundedIcon fontSize="small" />
    case 'gallery': return <PhotoLibraryRoundedIcon fontSize="small" />
    case 'device-backup': return <BackupRoundedIcon fontSize="small" />
    case 'remote-pull': return <CloudDownloadRoundedIcon fontSize="small" />
    case 'transfers': return <AssignmentOutlinedIcon fontSize="small" />
    case 'local-storage': return <StorageRoundedIcon fontSize="small" />
    case 'cloud-storage': return <CloudRoundedIcon fontSize="small" />
    case 'admin-users': return <ManageAccountsRoundedIcon fontSize="small" />
    default: return <AppsRoundedIcon fontSize="small" />
  }
}

export function xDriveBrowserMobileDestinations(
  adminVerified: boolean,
): XDriveSidebarDestinationModel[] {
  return Object.values(XDRIVE_WEB_APPS)
    .filter(item => item.sidebar && item.workspaceKey && item.id !== 'overview' &&
      (!item.admin || adminVerified))
    .map(item => ({
      key: item.workspaceKey!,
      label: item.title,
      icon: xDriveBrowserMobileDestinationIcon(item.workspaceKey!),
    }))
}

export type XDriveMobileRecentDestination = {
  route: XDriveWebAppRoute
  label: ReactNode
  icon: ReactNode
}

export function XDriveMobileFiveSlotNavigation({
  selected, dynamicLabel, dynamicIcon, recent, recentOpen,
  onRecentOpenChange, onSelect, onPickRecent,
}: {
  selected: XDriveMobileSlot
  dynamicLabel: ReactNode
  dynamicIcon?: ReactNode
  recent: XDriveMobileRecentDestination[]
  recentOpen: boolean
  onRecentOpenChange: (open: boolean) => void
  onSelect: (slot: XDriveMobileSlot) => void
  onPickRecent: (route: XDriveWebAppRoute) => void
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activePointer = useRef<{ id: number; origin: { x: number; y: number } } | null>(null)
  const heldPointer = useRef(false)
  const suppressReleaseClick = useRef(false)
  const clearLongPress = () => {
    if (longPressTimer.current !== null) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const cancelLongPress = () => {
    clearLongPress()
    activePointer.current = null
    heldPointer.current = false
  }
  useEffect(() => () => cancelLongPress(), [])
  const startLongPress = (event: ReactPointerEvent<HTMLElement>) => {
    // A new independent gesture must never inherit a missing synthetic click
    // from an earlier long hold. Secondary pointers and right-click do not hold.
    cancelLongPress()
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    suppressReleaseClick.current = false
    activePointer.current = {
      id: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
    }
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      if (!activePointer.current) return
      heldPointer.current = true
      suppressReleaseClick.current = true
      onRecentOpenChange(true)
    }, XDRIVE_MOBILE_ITEM_HOLD_MS)
  }
  const moveLongPress = (event: ReactPointerEvent<HTMLElement>) => {
    if (activePointer.current?.id !== event.pointerId) return
    // The same threshold as Files/Gallery: panning wins over hold.
    if (xDriveMobileItemMoved(activePointer.current.origin, {
      x: event.clientX, y: event.clientY,
    })) cancelLongPress()
  }
  const finishLongPress = (event: ReactPointerEvent<HTMLElement>) => {
    if (activePointer.current?.id !== event.pointerId) return
    if (heldPointer.current) {
      // Safari/Chromium may also dispatch a compatibility click on release.
      event.preventDefault()
      suppressReleaseClick.current = true
    }
    cancelLongPress()
  }
  const chooseDynamic = (event: ReactMouseEvent<HTMLElement>) => {
    if (suppressReleaseClick.current && event.detail !== 0) {
      suppressReleaseClick.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    // Keyboard/VoiceOver activation (detail=0) must remain accessible.
    suppressReleaseClick.current = false
    onSelect('dynamic')
  }

  return (
    <>
      <Box component="nav" aria-label="移动端五个功能入口" data-xdrive-mobile-five-slot
        sx={{
          flexShrink: 0, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper',
          pb: 'env(safe-area-inset-bottom)',
          pl: 'env(safe-area-inset-left)', pr: 'env(safe-area-inset-right)',
        }}>
        <BottomNavigation showLabels value={selected}
          sx={{
            height: 58, bgcolor: 'transparent',
            '& .MuiBottomNavigationAction-root': {
              minWidth: 0, maxWidth: 'none', px: 0.25, minHeight: 58,
              '& .MuiBottomNavigationAction-label': { fontSize: 11 },
              '& .MuiBottomNavigationAction-label.Mui-selected': { fontSize: 11 },
            },
            '@media (orientation: landscape) and (max-height: 500px)': {
              height: 44,
              '& .MuiBottomNavigationAction-root': {
                minHeight: 44, flexDirection: 'row', gap: 0.5,
              },
            },
          }}>
          <BottomNavigationAction value="all" label="全部"
            icon={<AppsRoundedIcon fontSize="small" />} aria-current={selected === 'all' ? 'page' : undefined}
            onClick={() => onSelect('all')} />
          <BottomNavigationAction value="dynamic" label={dynamicLabel}
            icon={dynamicIcon ?? <HistoryRoundedIcon fontSize="small" />}
            aria-current={selected === 'dynamic' ? 'page' : undefined}
            aria-label={'动态功能：' + String(dynamicLabel) + '，长按查看最近功能'}
            aria-haspopup="dialog" aria-expanded={recentOpen}
            sx={{ touchAction: 'manipulation' }}
            onPointerDown={startLongPress}
            onPointerMove={moveLongPress}
            onPointerUp={finishLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onContextMenu={event => {
              event.preventDefault()
              cancelLongPress()
              suppressReleaseClick.current = true
              onRecentOpenChange(true)
            }}
            onClick={chooseDynamic} />
          <BottomNavigationAction value="gallery" label="图库"
            icon={<PhotoLibraryRoundedIcon fontSize="small" />}
            aria-current={selected === 'gallery' ? 'page' : undefined}
            onClick={() => onSelect('gallery')} />
          <BottomNavigationAction value="files" label="文件"
            icon={<FolderOpenRoundedIcon fontSize="small" />}
            aria-current={selected === 'files' ? 'page' : undefined}
            onClick={() => onSelect('files')} />
          <BottomNavigationAction value="mine" label="我的"
            icon={<PersonRoundedIcon fontSize="small" />}
            aria-current={selected === 'mine' ? 'page' : undefined}
            onClick={() => onSelect('mine')} />
        </BottomNavigation>
      </Box>
      <Drawer anchor="bottom" open={recentOpen} onClose={() => onRecentOpenChange(false)}
        slotProps={{ paper: {
          sx: {
            maxHeight: '75dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            pb: 'max(12px, env(safe-area-inset-bottom))',
            px: 'max(16px, env(safe-area-inset-left))',
          },
        } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1 }}>
          <Typography component="h2" variant="subtitle1" fontWeight={700}>最近使用的功能</Typography>
          <Button onClick={() => onRecentOpenChange(false)} sx={{ minHeight: 44 }}>关闭</Button>
        </Stack>
        {recent.length ? <List component="nav" aria-label="最近动态功能" sx={{ overflowY: 'auto' }}>
          {recent.map(item => (
            <ListItemButton key={item.route.app} sx={{ minHeight: 48 }}
              onClick={() => { onRecentOpenChange(false); onPickRecent(item.route) }}>
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List> : (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            暂无最近动态功能。请先从“全部”选择备份、传输或其他可用功能。
          </Typography>
        )}
      </Drawer>
    </>
  )
}

export function XDriveMobileAllLauncher({
  sections, onSelect, onOpenRecent, favoriteKeys, onToggleFavorite,
}: {
  sections: XDriveSidebarSectionModel[]
  onSelect: (key: string) => void
  onOpenRecent: () => void
  favoriteKeys: readonly string[]
  onToggleFavorite: (key: string) => void
}) {
  const [search, setSearch] = useState('')
  const favorites = new Set(favoriteKeys)
  const term = search.trim().toLocaleLowerCase()
  const entries = sections.flatMap(section => section.items)
  const unique = new Map(entries.map(item => [item.key, item]))
  const matches = (item: XDriveSidebarDestinationModel) =>
    !term || String(item.label ?? '').toLocaleLowerCase().includes(term)
  const showGroup = (title: string, items: XDriveSidebarDestinationModel[]) => {
    const visible = items.filter(matches)
    if (!visible.length) return null
    return (
      <Box key={title} component="section" sx={{ mt: 2 }}>
        <Typography component="h2" variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>{title}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 1 }}>
          {visible.map(item => (
            <Box key={item.key} sx={{ minWidth: 0, textAlign: 'center' }}>
              <Box sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <ButtonBase onClick={() => onSelect(item.key)}
                  aria-label={'打开' + String(item.label)}
                  sx={{ width: '100%', minHeight: 98, display: 'flex', flexDirection: 'column', gap: 0.5, px: 1, pt: 1.5, pb: 1 }}>
                  <Box sx={{ color: 'primary.main', '& svg': { fontSize: 28 } }}>{item.icon}</Box>
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{item.label}</Typography>
                </ButtonBase>
                <IconButton size="small" aria-label={favorites.has(item.key) ? '取消收藏' : '收藏功能'}
                  onClick={() => onToggleFavorite(item.key)}
                  sx={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44 }}>
                  {favorites.has(item.key) ? <StarRoundedIcon sx={{ fontSize: 17 }} /> :
                    <StarBorderRoundedIcon sx={{ fontSize: 17 }} />}
                </IconButton>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }
  const favoritesItems = [...unique.values()].filter(item => favorites.has(item.key))
  return (
    <Box data-xdrive-mobile-all-launcher sx={{ width: '100%', maxWidth: 820, mx: 'auto', p: 2, pb: 4 }}>
      <Typography component="h1" variant="h6" fontWeight={700}>全部功能</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        图库、文件和常用功能。当前 Web 只访问已授权的云端照片；本机照片由您手动选择上传。
      </Typography>
      <TextField fullWidth size="small" type="search" label="搜索功能" value={search}
        onChange={event => setSearch(event.target.value)} inputProps={{ 'aria-label': '搜索功能' }} />
      <Button startIcon={<HistoryRoundedIcon />} onClick={onOpenRecent}
        sx={{ minHeight: 44, mt: 1 }}>最近动态功能</Button>
      {showGroup('收藏', favoritesItems)}
      {sections.map(section => showGroup(String(section.label ?? '其他功能'), section.items))}
      {term && ![...unique.values()].some(matches) ? (
        <Typography color="text.secondary" role="status" sx={{ mt: 2 }}>没有匹配的功能。</Typography>
      ) : null}
    </Box>
  )
}

export function XDriveMobileMinePage({
  username, serverOrigin, serverVersion, accountAction, profileVerified,
}: {
  username: string
  serverOrigin: string
  serverVersion: string
  accountAction: ReactNode
  profileVerified: boolean
}) {
  return (
    <Box data-xdrive-mobile-mine-page sx={{ maxWidth: 640, width: '100%', mx: 'auto', p: 2 }}>
      <Typography component="h1" variant="h6" fontWeight={700} sx={{ mb: 2 }}>我的</Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>{username}</Typography>
        <Typography variant="body2" color="text.secondary" role="status">
          {profileVerified ? '当前服务器已验证的登录账号' : '正在验证当前服务器账号'}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
          {accountAction}
          <Typography variant="body2">点击头像打开设置、服务器入口或退出登录</Typography>
        </Stack>
      </Box>
      <Box sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Typography variant="subtitle2">当前服务器</Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{serverOrigin}</Typography>
        <Typography variant="body2" color="text.secondary">Server {serverVersion}</Typography>
        <Typography variant="caption" color="text.secondary">
          浏览器版通过当前站点地址和已验证会话访问服务器。系统相册权限与后台自动备份仅由原生 App 提供。
        </Typography>
      </Box>
    </Box>
  )
}
