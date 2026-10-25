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
  onClose, onRetry, onOpenPhoto, onOpenAll, onOpenNearby, initialPresentation,
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
  /** Same signed Owner camera viewport as the map's original camera wall. */
  onOpenNearby?: () => void
  initialPresentation?: XDrivePlacesDrawerPresentation
}) {
  const dragStart = useRef<{ pointerId: number; startX: number; startY: number } | null>(null)
  const suppressDragClick = useRef(false)
  // A real touch can end on an authorized photo button without a subsequent
  // browser-synthesized click (e.g. after an inertial scroll/drag). Activate the
  // genuine short tap once from pointerup; preserve native click for mouse,
  // keyboard and platforms that do emit it. Never capture the scrolling tile.
  const photoTouch = useRef<{
    pointerId:number; nodeID:number; startX:number; startY:number;
    startAt:number; moved:boolean
  } | null>(null)
  const touchActivated = useRef<{nodeID:number; at:number} | null>(null)
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
      sx={{position:'absolute',
        left:{xs:'max(8px, env(safe-area-inset-left))',sm:16},
        right:{xs:'max(8px, env(safe-area-inset-right))',sm:'auto'},
        bottom:{xs:'max(8px, env(safe-area-inset-bottom))',sm:16},
        width:{xs:'auto',sm:'min(560px, calc(100% - 32px))'},
        zIndex:8,pointerEvents:'auto',bgcolor:'background.paper',
        border:'1px solid',borderColor:'divider',borderRadius:3,
        boxShadow:'0 12px 42px rgba(15,23,42,.36)',overflow:'hidden',
        height:expanded ? {xs:'min(75dvh,580px)',sm:'min(76dvh,640px)'} : 'auto',
        maxHeight:expanded ? {xs:'min(75dvh,580px)',sm:'min(76dvh,640px)'} : 250,
        display:'flex',flexDirection:'column'}}>
      <Box sx={{flexShrink:0}}>
        <Box component="button" type="button"
          data-xdrive-places-photo-drawer-handle
          data-xdrive-places-photo-drawer-grip
          aria-label={expanded ? '收起照片抽屉' : '展开照片抽屉'}
          aria-expanded={expanded}
          onPointerDown={event => {
            suppressDragClick.current = false
            if (!event.isPrimary ||
                (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return
            dragStart.current = {pointerId:event.pointerId,
              startX:event.clientX,startY:event.clientY}
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={event => {
            const start = dragStart.current
            dragStart.current = null
            if (!start || start.pointerId !== event.pointerId) return
            const dx = event.clientX-start.startX
            const dy = event.clientY-start.startY
            // Reject small motions and horizontal scrolling.
            if (Math.abs(dy)<36 || Math.abs(dy)<Math.abs(dx)*1.25) return
            suppressDragClick.current = true
            onExpand(dy<0)
          }}
          onPointerCancel={() => { dragStart.current = null }}
          onLostPointerCapture={() => { dragStart.current = null }}
          onClick={event => {
            // A synthesized touch click must not undo the successful swipe.
            if (event.detail > 0 && suppressDragClick.current) {
              suppressDragClick.current = false
              event.preventDefault()
              return
            }
            onExpand(!expanded)
          }}
          sx={{width:'100%',minHeight:36,display:'grid',placeItems:'center',
            border:0,p:0,bgcolor:'transparent',color:'text.primary',
            cursor:'grab',touchAction:'none',
            '&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',
              outlineOffset:-3}}}>
          <Box sx={{width:38,height:4,borderRadius:3,bgcolor:'text.disabled'}} />
        </Box>
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
              overscrollBehavior:'contain',touchAction:'auto'}}>
            {items.map(item => (
              <Box key={item.node.id} component="button" type="button"
                data-xdrive-places-photo-drawer-item={item.node.id}
                aria-label={`查看 ${item.node.name}`}
                onPointerDown={event => {
                  if (event.pointerType !== 'touch') {
                    // A real mouse press is not the prior touch's compatibility click.
                    if (event.pointerType === 'mouse') touchActivated.current=null
                    return
                  }
                  if (!event.isPrimary) {
                    // A second contact cancels the first tap without granting access.
                    const former=photoTouch.current
                    if (former) touchActivated.current={nodeID:former.nodeID,at:event.timeStamp}
                    photoTouch.current=null
                    return
                  }
                  photoTouch.current = {pointerId:event.pointerId,nodeID:item.node.id,
                    startX:event.clientX,startY:event.clientY,startAt:event.timeStamp,
                    moved:false}
                }}
                onPointerMove={event => {
                  const tap=photoTouch.current
                  if (!tap || tap.pointerId!==event.pointerId) return
                  if (Math.hypot(event.clientX-tap.startX,event.clientY-tap.startY)>12)
                    tap.moved=true
                }}
                onPointerCancel={event => {
                  const tap=photoTouch.current
                  if (!tap || tap.pointerId!==event.pointerId) return
                  // Browser-generated clicks following a cancelled scroll/contact
                  // must never open a private Viewer.
                  touchActivated.current={nodeID:tap.nodeID,at:event.timeStamp}
                  photoTouch.current=null
                }}
                onPointerUp={event => {
                  const tap=photoTouch.current
                  if (!tap || tap.pointerId!==event.pointerId) return
                  photoTouch.current=null
                  if (event.pointerType!=='touch' || tap.nodeID!==item.node.id) return
                  // Consume any subsequent compatibility click, including after
                  // an invalid long press or drag. Only a valid short primary
                  // touch is allowed to activate the authorized Owner range.
                  touchActivated.current={nodeID:item.node.id,at:event.timeStamp}
                  if (tap.moved ||
                      Math.hypot(event.clientX-tap.startX,event.clientY-tap.startY)>12 ||
                      event.timeStamp-tap.startAt>700) return
                  onOpenPhoto(item,position())
                }}
                onClick={event => {
                  const handled=touchActivated.current
                  if (event.detail>0 && handled?.nodeID===item.node.id &&
                      event.timeStamp>=handled.at &&
                      event.timeStamp-handled.at<900) {
                    // Native compatibility click follows the handled touch.
                    // Do not issue a second Viewer authorization /cell-items.
                    touchActivated.current=null
                    return
                  }
                  onOpenPhoto(item,position())
                }}
                sx={{appearance:'none',touchAction:'manipulation',p:0,flex:expanded?undefined:'0 0 92px',
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
            spacing={1} sx={{px:1.25,pb:1,pt:0.25,flexShrink:0,flexWrap:'wrap',rowGap:0.25}}>
            <Typography variant="caption" color="text.secondary">
              {items.length < total
                ? `预览前 ${items.length.toLocaleString('zh-CN')} 张`
                : '此地点全部照片'}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.25}>
              {onOpenNearby ? (
                <Button data-xdrive-places-photo-drawer-nearby
                  variant="text" onClick={onOpenNearby}
                  aria-label="显示当前地图范围的附近照片"
                  sx={{minHeight:44,textTransform:'none'}}>
                  显示附近照片
                </Button>
              ) : null}
              <Button data-xdrive-places-photo-drawer-open-all
                variant="text" onClick={onOpenAll}
                sx={{minHeight:44,textTransform:'none'}}>
                查看全部
              </Button>
            </Stack>
          </Stack>
        </>
      )}
    </Box>
  )
}
