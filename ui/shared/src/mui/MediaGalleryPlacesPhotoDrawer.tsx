import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Dialog, IconButton, Stack, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import type { MediaItem } from '../models'
import { XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT } from '../media-gallery-places-photo-drawer'
import type { XDrivePlacesDrawerPresentation } from '../media-gallery-places-photo-drawer'
import type { MediaThumbnailLoader } from './MediaGallery'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'

/** Trusted Parent-only photo sheet; no Baidu SDK data or media URLs cross the Child. */
export function XDriveMediaGalleryPlacesPhotoDrawer({
  items, total, phase, expanded, loadingMore, pageError, loadThumbnail, onExpand,
  onClose, onRetry, onRefreshMap, onLoadMore, onOpenPhoto, onOpenAll, onOpenNearby, initialPresentation,
}: {
  items: MediaItem[]
  total: number
  phase: 'loading' | 'ready' | 'error'
  expanded: boolean
  loadingMore: boolean
  pageError: boolean
  loadThumbnail: MediaThumbnailLoader
  onExpand: (expanded: boolean) => void
  onClose: () => void
  onRetry: () => void
  onRefreshMap: () => void
  onLoadMore: () => void
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
  const appliedReturn = useRef<HTMLDivElement | null>(null)
  // MUI Dialog's focus trap and Enter transition can reset the scroll position
  // after the first two animation frames. Use the real transition completion
  // as an additional gate, without weakening the fresh Owner Cell page gate.
  const [portalEntered, setPortalEntered] = useState(false)
  // Restore only when this trusted Parent Dialog actually finished entering
  // and a NEW authenticated Owner Cell Range has populated its grid. Never
  // replay old image bytes, reset the camera, or borrow SDK Child state.
  useLayoutEffect(() => {
    if (phase !== 'ready') { appliedReturn.current = null; return }
    const node = listRef.current
    if (!node || appliedReturn.current === node) return
    const target=Math.min(initialPresentation?.loadedCount ?? 0,total)
    if (items.length < target && !pageError) return
    if (!initialPresentation) { appliedReturn.current=node; return }
    // The prior attempt restored during Dialog's focus/Enter lifecycle; MUI
    // subsequently focused the first tile and scrolled the gallery to top.
    // This one-shot post-enter check wins that race without disabling the
    // Dialog's keyboard focus trap or its accessible default focus.
    if (!portalEntered) return
    const view=node.ownerDocument.defaultView
    const apply = () => {
      if (listRef.current !== node || !node.isConnected) return
      node.scrollTop = initialPresentation.scrollTop
      node.scrollLeft = initialPresentation.scrollLeft
    }
    apply()
    let first: number | undefined
    let second: number | undefined
    if (view) {
      first=view.requestAnimationFrame(() => {
        apply()
        second=view.requestAnimationFrame(() => {
          apply()
          if (listRef.current === node) appliedReturn.current=node
        })
      })
    } else {
      appliedReturn.current=node
    }
    return () => {
      if (first !== undefined) view?.cancelAnimationFrame(first)
      if (second !== undefined) view?.cancelAnimationFrame(second)
    }
  }, [phase, expanded, initialPresentation, items.length, total, pageError, portalEntered])
  useEffect(() => {
    if (phase !== 'ready' || !initialPresentation || loadingMore || pageError ||
        items.length>=total ||
        (initialPresentation.loadedCount ?? 0)<=items.length) return
    // User previously visited these pages. Only restore their bounded count
    // through NEW authenticated /cell-items, never reuse old media bytes.
    onLoadMore()
  }, [phase, initialPresentation, loadingMore, pageError, items.length, total, onLoadMore])
  const position = (): XDrivePlacesDrawerPresentation => {
    const bounded = (n: number) => Number.isFinite(n)
      ? Math.max(0, Math.min(10_000, Math.floor(n))) : 0
    return {expanded, scrollTop: bounded(listRef.current?.scrollTop ?? 0),
      scrollLeft: bounded(listRef.current?.scrollLeft ?? 0),
      loadedCount:Math.min(XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,items.length)}
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" disableScrollLock
      TransitionProps={{onEntered: () => setPortalEntered(true)}}
      // Avoid a body scrollbar-width resize remounting/invalidation of the
      // underlying active map while this photo modal opens.
      aria-labelledby="xdrive-places-album-title" data-xdrive-places-album-dialog
      // This is the SAME shared Owner Gallery UI for both map SDK Hosts.
      // MUI Dialog owns focus trap, Escape, backdrop and scroll lock.
      PaperProps={{sx:{width:{xs:'calc(100% - max(8px, env(safe-area-inset-left)) - max(8px, env(safe-area-inset-right)))',sm:'min(880px, calc(100vw - 40px))'},
        maxWidth:880,maxHeight:'min(86dvh, 820px)',m:1,
        borderRadius:{xs:2.5,sm:3},overflow:'hidden',
        bgcolor:'background.paper',boxShadow:'0 16px 54px rgba(0,0,0,.34)'}}}>
    <Box component="section" role="region" aria-label="当前位置的照片"
      data-xdrive-places-photo-drawer
      sx={{width:'100%',minWidth:0,pointerEvents:'auto',
        height:expanded?'min(80dvh, 760px)':'auto',
        maxHeight:'min(86dvh, 820px)',overflow:'hidden',
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
          onPointerCancel={event => {
            if (dragStart.current?.pointerId !== event.pointerId) return
            // A cancelled touch must not turn into an accidental click.
            // The next valid primary pointerdown resets this guard.
            suppressDragClick.current = true
            dragStart.current = null
          }}
          onLostPointerCapture={event => {
            if (dragStart.current?.pointerId !== event.pointerId) return
            // Capture loss without pointerup is also a cancelled drag.
            suppressDragClick.current = true
            dragStart.current = null
          }}
          onClick={event => {
            // A synthesized touch click must not undo the successful swipe.
            if (event.detail > 0 && suppressDragClick.current) {
              suppressDragClick.current = false
              event.preventDefault()
              return
            }
            onExpand(!expanded)
          }}
          sx={{width:'100%',minHeight:44,display:'grid',placeItems:'center',
            border:0,p:0,bgcolor:'transparent',color:'text.primary',
            cursor:'grab',touchAction:'none',
            '&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',
              outlineOffset:-3}}}>
          <Box sx={{width:38,height:4,borderRadius:3,bgcolor:'text.disabled'}} />
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{px:1.25,pb:0.5}}>
          <Box sx={{flex:1,minWidth:0}}>
            <Typography id="xdrive-places-album-title" variant="body2" fontWeight={750}>此地点的照片</Typography>
            <Typography variant="caption" color="text.secondary">
              {phase==='ready'
                ? `${total.toLocaleString('zh-CN')} 张照片和视频`
                : phase==='loading' ? '正在加载该地点的照片…' : '照片范围已变化'}
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
            该地点照片读取失败或范围已变化。可重试当前地点；如照片数量已变化，请刷新地图。
          </Typography>
          <Button size="small" variant="outlined" onClick={onRetry}
            sx={{minHeight:44}} data-xdrive-places-photo-drawer-retry>
            重试此地点照片
          </Button>
          <Button size="small" variant="text" onClick={onRefreshMap}
            sx={{minHeight:44}} data-xdrive-places-photo-drawer-refresh-map>
            刷新地图
          </Button>
        </Stack>
      ) : (
        <>
          <Box ref={listRef} data-xdrive-places-photo-drawer-items
            onScroll={event => {
              const list=event.currentTarget
              if (expanded && !loadingMore && !pageError && items.length < total &&
                  list.scrollHeight-list.scrollTop-list.clientHeight < 180) onLoadMore()
            }}
            sx={{px:1.25,py:0.75,overflowX:expanded?'hidden':'auto',
              overflowY:expanded?'auto':'hidden',minHeight:0,minWidth:0,
              // Chromium may shift scrollTop by the viewport-height delta on
              // rotation before Parent captures the signed reauthorization hint.
              // Keep the user's pre-rotation visual anchor; fresh Owner pages
              // are still required before any tile can be opened again.
              overflowAnchor:'none',
              flex:expanded?'1 1 auto':'0 1 auto',
              display:expanded?'grid':'flex',gap:1,
              gridTemplateColumns:expanded?'repeat(auto-fill, minmax(108px, 1fr))':undefined,
              // Grid's implicit auto tracks can collapse under the bounded
              // MUI Dialog's flex height: 142 real tiles then fit into only
              // ~460px and the grid has NO vertical overflow. A real minimum
              // tile track restores scrolling without changing Owner paging.
              gridAutoRows:expanded?'minmax(132px, max-content)':undefined,
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
                ? `已显示 ${items.length.toLocaleString('zh-CN')} / ${total.toLocaleString('zh-CN')} 张`
                : '此地点全部照片'}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.25}>
              {items.length < total ? (
                <Button data-xdrive-places-photo-drawer-load-more
                  variant="outlined" onClick={onLoadMore} disabled={loadingMore}
                  aria-label="继续加载此地点的照片"
                  sx={{minHeight:44,textTransform:'none'}}>
                  {loadingMore ? '正在加载…' : '加载更多'}
                </Button>
              ) : null}
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
          {pageError && items.length < total ? (
            <Typography variant="caption" role="alert"
              data-xdrive-places-photo-drawer-page-error
              sx={{px:1.25,pb:1,color:'error.main'}}>
              后续照片读取失败，请重试。已验证的照片仍可查看。
            </Typography>
          ) : null}
        </>
      )}
    </Box>
    </Dialog>
  )
}
