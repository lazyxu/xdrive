import { useLayoutEffect, useRef } from 'react'
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import type { MediaItem } from '../models'
import type { XDrivePlacesDrawerPresentation } from '../media-gallery-places-photo-drawer'
import type { MediaThumbnailLoader } from './MediaGallery'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'

/** Trusted Parent-only photo sheet; no Baidu SDK data or media URLs cross the Child. */
export function XDriveMediaGalleryPlacesPhotoDrawer({
  items, total, phase, expanded, loadThumbnail, onExpand,
  onClose, onRetry, onOpenPhoto, onOpenAll, initialPresentation,
}: {
  items: MediaItem[]
  total: number
  phase: 'loading' | 'ready' | 'error'
  expanded: boolean
  loadThumbnail: MediaThumbnailLoader
  onExpand: (expanded: boolean) => void
  onClose: () => void
  onRetry: () => void
  onOpenPhoto: (item: MediaItem, presentation: XDrivePlacesDrawerPresentation) => void
  onOpenAll: () => void
  initialPresentation?: XDrivePlacesDrawerPresentation
}) {
  const touchY = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const appliedReturn = useRef(false)
  // Restore only after the *fresh* Owner Range has produced real grid cells.
  // Never store photos, GPS or Scroll DOM in a global viewer-return session.
  useLayoutEffect(() => {
    if (phase !== 'ready') { appliedReturn.current = false; return }
    const node = listRef.current
    if (!node || appliedReturn.current) return
    appliedReturn.current = true
    if (initialPresentation) {
      node.scrollTop = initialPresentation.scrollTop
      node.scrollLeft = initialPresentation.scrollLeft
    }
  }, [phase, expanded, initialPresentation])
  const position = (): XDrivePlacesDrawerPresentation => {
    const bounded = (n: number) => Number.isFinite(n)
      ? Math.max(0, Math.min(10_000, Math.floor(n))) : 0
    return {expanded, scrollTop: bounded(listRef.current?.scrollTop ?? 0),
      scrollLeft: bounded(listRef.current?.scrollLeft ?? 0)}
  }
  return (
    <Box component="section" role="region" aria-label="当前位置的照片"
      data-xdrive-places-photo-drawer
      sx={{position:'absolute',left:{xs:8,sm:16},right:{xs:8,sm:'auto'},
        bottom:{xs:'max(8px, env(safe-area-inset-bottom))',sm:16},
        width:{xs:'calc(100% - 16px)',sm:'min(560px, calc(100% - 32px))'},
        zIndex:8,pointerEvents:'auto',bgcolor:'background.paper',
        border:'1px solid',borderColor:'divider',borderRadius:3,
        boxShadow:'0 12px 42px rgba(15,23,42,.36)',overflow:'hidden',
        height:expanded ? {xs:'min(75dvh,580px)',sm:'min(76dvh,640px)'} : 'auto',
        maxHeight:expanded ? {xs:'min(75dvh,580px)',sm:'min(76dvh,640px)'} : 250,
        display:'flex',flexDirection:'column'}}>
      <Box data-xdrive-places-photo-drawer-handle
        onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null }}
        onTouchEnd={event => {
          const start=touchY.current
          touchY.current=null
          const finish=event.changedTouches[0]?.clientY
          if(start===null || finish===undefined)return
          if(start-finish>28)onExpand(true)
          else if(finish-start>28)onExpand(false)
        }}
        sx={{touchAction:'pan-y',pt:0.75,flexShrink:0}}>
        <Box sx={{width:38,height:4,borderRadius:3,mx:'auto',
          bgcolor:'text.disabled',mb:0.75}} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{px:1.25,pb:0.5}}>
          <Box sx={{flex:1,minWidth:0}}>
            <Typography variant="body2" fontWeight={750}>此地点的照片</Typography>
            <Typography variant="caption" color="text.secondary">
              {phase==='ready'
                ? `${total.toLocaleString('zh-CN')} 张照片和视频`
                : phase==='loading' ? '正在加载已授权照片…' : '照片范围已变化'}
            </Typography>
          </Box>
          <IconButton size="small" aria-label={expanded ? '收起照片抽屉' : '展开照片抽屉'}
            data-xdrive-places-photo-drawer-expand
            onClick={() => onExpand(!expanded)}
            sx={{minWidth:44,minHeight:44}}>
            {expanded ? <ExpandMoreRoundedIcon /> : <ExpandLessRoundedIcon />}
          </IconButton>
          <IconButton size="small" aria-label="关闭照片抽屉"
            data-xdrive-places-photo-drawer-close onClick={onClose}
            sx={{minWidth:44,minHeight:44}}>
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </Box>
      {phase==='loading' ? (
        <Stack role="status" direction="row" spacing={1} alignItems="center"
          sx={{px:2,py:3,minHeight:100}}>
          <CircularProgress size={18}/>
          <Typography variant="body2" color="text.secondary">正在核对当前位置的照片…</Typography>
        </Stack>
      ) : phase==='error' ? (
        <Stack role="alert" direction="row" alignItems="center" spacing={1}
          sx={{px:2,py:2,flexWrap:'wrap'}}>
          <Typography variant="body2" color="text.secondary">
            该地点照片已变化，请重新验证。
          </Typography>
          <Button size="small" variant="outlined" onClick={onRetry}
            data-xdrive-places-photo-drawer-retry>刷新地图</Button>
        </Stack>
      ) : (
        <>
          <Box ref={listRef} data-xdrive-places-photo-drawer-items
            sx={{px:1.25,py:0.75,overflowX:expanded?'hidden':'auto',
              overflowY:expanded?'auto':'hidden',minHeight:0,minWidth:0,
              flex:expanded?'1 1 auto':'0 1 auto',
              display:expanded?'grid':'flex',gap:1,
              gridTemplateColumns:expanded?'repeat(auto-fill, minmax(92px, 1fr))':undefined,
              overscrollBehavior:'contain',touchAction:expanded?'pan-y':'pan-x'}}>
            {items.map(item => (
              <Box key={item.node.id} component="button" type="button"
                data-xdrive-places-photo-drawer-item={item.node.id}
                aria-label={`查看 ${item.node.name}`}
                onClick={() => onOpenPhoto(item, position())}
                sx={{appearance:'none',p:0,flex:expanded?undefined:'0 0 92px',
                  width:expanded?'100%':92,minWidth:0,
                  border:'1px solid',borderColor:'divider',borderRadius:1.5,
                  bgcolor:'action.hover',textAlign:'left',overflow:'hidden',
                  cursor:'pointer',color:'text.primary',
                  '&:focus-visible':{outline:'3px solid',
                    outlineColor:'primary.main',outlineOffset:2}}}>
                <Box sx={{width:'100%',aspectRatio:'1',overflow:'hidden'}}>
                  <XDriveMediaGalleryCoverThumbnail
                    nodeID={item.node.id} revision={item.node.revision}
                    alt={item.node.name} loadThumbnail={loadThumbnail}
                    fallback={<Box sx={{height:'100%',display:'grid',
                      placeItems:'center',color:'text.secondary'}}>
                      <PhotoLibraryOutlinedIcon fontSize="small"/>
                    </Box>}/>
                </Box>
                <Typography variant="caption" component="span" noWrap
                  sx={{display:'block',px:0.5,py:0.5,fontSize:10}}>
                  {item.node.name}
                </Typography>
              </Box>
            ))}
          </Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between"
            spacing={1} sx={{px:1.25,pb:1,pt:0.25,flexShrink:0}}>
            <Typography variant="caption" color="text.secondary">
              {items.length < total
                ? `预览前 ${items.length.toLocaleString('zh-CN')} 张`
                : '此地点全部照片'}
            </Typography>
            <Button data-xdrive-places-photo-drawer-open-all
              variant="text" onClick={onOpenAll}
              sx={{minHeight:44,textTransform:'none'}}>
              查看全部
            </Button>
          </Stack>
        </>
      )}
    </Box>
  )
}
