import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Box, Button, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import type {
  MediaAlbum, MediaMemory, MediaPersonIdentity, MediaPetFacet,
  MediaPlaceFacet, MediaSyncFolder,
} from '../models'
import type { MediaThumbnailLoader } from './MediaGallery'
import type { MediaGallerySection } from './MediaGalleryNavigation'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'
import { readMediaAlbumPreferences, sortedMediaAlbums } from './MediaGalleryAlbumOrganization'


type GalleryCollectionGroupID =
  | 'pinned' | 'memories' | 'albums' | 'people'
  | 'places' | 'sync-folders' | 'utilities'
type GalleryCollectionsLayout = 'mixed' | 'large' | 'small'
type GalleryCollectionsPresentation = {
  layout: GalleryCollectionsLayout
  collapsed: GalleryCollectionGroupID[]
}
const GROUP_IDS: readonly GalleryCollectionGroupID[] = [
  'pinned', 'memories', 'albums', 'people', 'places', 'sync-folders', 'utilities',
]
const COLLECTIONS_LAYOUT_KEY = 'xdrive.gallery.mobile.collections.layout.v1'
function normalizeCollectionPresentation(value: unknown): GalleryCollectionsPresentation {
  const fallback: GalleryCollectionsPresentation = { layout: 'mixed', collapsed: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const data = value as Partial<GalleryCollectionsPresentation>
  const layout: GalleryCollectionsLayout =
    data.layout === 'large' || data.layout === 'small' ? data.layout : 'mixed'
  const collapsed = Array.isArray(data.collapsed)
    ? Array.from(new Set(data.collapsed.filter((id): id is GalleryCollectionGroupID =>
        GROUP_IDS.includes(id as GalleryCollectionGroupID))))
    : []
  return { layout, collapsed }
}
export function xDriveReadMobileGalleryCollectionsPresentation(accountScope: string): GalleryCollectionsPresentation {
  if (!accountScope || typeof window === 'undefined') return normalizeCollectionPresentation(null)
  try {
    return normalizeCollectionPresentation(JSON.parse(
      window.localStorage.getItem(COLLECTIONS_LAYOUT_KEY + ':' + encodeURIComponent(accountScope)) || 'null',
    ))
  } catch {
    return normalizeCollectionPresentation(null)
  }
}
export function xDriveWriteMobileGalleryCollectionsPresentation(
  accountScope: string, value: GalleryCollectionsPresentation,
) {
  if (!accountScope || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      COLLECTIONS_LAYOUT_KEY + ':' + encodeURIComponent(accountScope),
      JSON.stringify(normalizeCollectionPresentation(value)),
    )
  } catch {
    // Private-mode storage failures cannot prevent browsing or switching layouts.
  }
}
/** Presentation geometry only. Media item paging still belongs to shared VirtualCollection. */
export function xDriveMobileGalleryCollectionTileWidth(
  layout: GalleryCollectionsLayout, group: GalleryCollectionGroupID,
) {
  if (layout === 'large') return 196
  if (layout === 'small') return 104
  // The mixed default intentionally gives Memories more visual weight.
  if (group === 'memories') return 184
  if (group === 'pinned' || group === 'utilities') return 132
  return 144
}


const ORDER_KEY = 'xdrive.gallery.mobile.collections.group-order.v1'
export function xDriveNormalizeMobileGalleryGroupOrder(value: unknown): GalleryCollectionGroupID[] {
  const valid: GalleryCollectionGroupID[] = []
  if (Array.isArray(value)) {
    for (const id of value) {
      if (GROUP_IDS.includes(id as GalleryCollectionGroupID) &&
          !valid.includes(id as GalleryCollectionGroupID)) {
        valid.push(id as GalleryCollectionGroupID)
      }
    }
  }
  return [...valid, ...GROUP_IDS.filter((id) => !valid.includes(id))]
}
export function xDriveReadMobileGalleryGroupOrder(accountScope: string): GalleryCollectionGroupID[] {
  if (!accountScope || typeof window === 'undefined') return [...GROUP_IDS]
  try {
    return xDriveNormalizeMobileGalleryGroupOrder(JSON.parse(
      window.localStorage.getItem(ORDER_KEY + ':' + encodeURIComponent(accountScope)) || 'null',
    ))
  } catch {
    return [...GROUP_IDS]
  }
}
export function xDriveWriteMobileGalleryGroupOrder(accountScope: string, order: readonly GalleryCollectionGroupID[]) {
  if (!accountScope || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ORDER_KEY + ':' + encodeURIComponent(accountScope),
      JSON.stringify(xDriveNormalizeMobileGalleryGroupOrder(order)),
    )
  } catch {
    // Browsing remains functional if storage is disabled.
  }
}
export function xDriveMoveMobileGalleryGroup(
  order: readonly GalleryCollectionGroupID[], source: GalleryCollectionGroupID,
  target: GalleryCollectionGroupID,
): GalleryCollectionGroupID[] {
  const current = xDriveNormalizeMobileGalleryGroupOrder(order)
  if (source === target || !current.includes(source) || !current.includes(target)) return current
  const from = current.indexOf(source)
  const to = current.indexOf(target)
  const result = current.filter((id) => id !== source)
  result.splice(result.indexOf(target) + (from < to ? 1 : 0), 0, source)
  return result
}
type GalleryCollectionGroupModel = {
  id: GalleryCollectionGroupID
  title: string
  cards: readonly CollectionCard[]
  onViewAll?: () => void
}

type CollectionCard = {
  key: string
  title: string
  detail?: string
  coverNodeID?: number
  activate: () => void
}

export interface XDriveMobileGalleryCollectionsProps {
  accountScope?: string
  albums: readonly MediaAlbum[]
  memories: readonly MediaMemory[]
  people: readonly MediaPersonIdentity[]
  pets: readonly MediaPetFacet[]
  places: readonly MediaPlaceFacet[]
  syncFolders: readonly MediaSyncFolder[]
  loadThumbnail: MediaThumbnailLoader
  onOpenSection: (section: MediaGallerySection) => void
  onOpenAlbum?: (album: MediaAlbum) => void
  onOpenMemory?: (memory: MediaMemory) => void
  onOpenPerson?: (person: MediaPersonIdentity) => void
  onOpenPet?: (pet: MediaPetFacet) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenSyncFolder?: (folder: MediaSyncFolder) => void
}

function CollectionCover({
  title, nodeID, loadThumbnail,
}: { title: string; nodeID?: number; loadThumbnail: MediaThumbnailLoader }) {
  const host = useRef<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    // Merely using <img loading="lazy"> would still start every Blob loader:
    // hold thumbnail requests until the card is near the actual viewport.
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    if (!host.current) return
    const observer = new IntersectionObserver((entries) => {
      setNearViewport(entries.some((entry) => entry.isIntersecting))
    }, { rootMargin: '180px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [nodeID])
  return (
    <Box ref={host} sx={{ aspectRatio: '1 / 1', width: '100%',
      overflow: 'hidden', borderRadius: 2.5, bgcolor: 'action.hover' }}>
      {nearViewport && nodeID ? (
        <XDriveMediaAsyncThumbnail
          nodeID={nodeID} alt={title} loadThumbnail={loadThumbnail}
          fallback={(
            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              <PhotoLibraryOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
            </Box>
          )}
        />
      ) : (
        <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
          <PhotoLibraryOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
        </Box>
      )}
    </Box>
  )
}


function CollectionGroup({
  id, title, cards, loadThumbnail, onViewAll, layout, collapsed, onToggleCollapsed,
}: {
  id: GalleryCollectionGroupID
  title: string
  cards: readonly CollectionCard[]
  loadThumbnail: MediaThumbnailLoader
  onViewAll?: () => void
  layout: GalleryCollectionsLayout
  collapsed: boolean
  onToggleCollapsed: (id: GalleryCollectionGroupID) => void
}) {
  if (!cards.length && !onViewAll) return null
  const tileWidth = xDriveMobileGalleryCollectionTileWidth(layout, id)
  return (
    <Stack spacing={1} data-xdrive-mobile-gallery-collection-group={title}
      data-xdrive-mobile-gallery-collection-group-id={id}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5 }}>
        <Typography component="h3" fontWeight={750} variant="h6">
          {title}
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center">
          {onViewAll ? (
            <Button size="small" data-xdrive-mobile-gallery-view-all={title}
              aria-label={'查看全部' + title}
              onClick={onViewAll} sx={{ minHeight: 44, minWidth: 72 }}>
              查看全部
            </Button>
          ) : null}
          <IconButton size="small" data-xdrive-mobile-gallery-collapse-group={id}
            aria-label={(collapsed ? '展开' : '折叠') + title}
            aria-expanded={!collapsed}
            aria-controls={'xdrive-mobile-gallery-group-content-' + id}
            onClick={() => onToggleCollapsed(id)}
            sx={{ minHeight: 44, minWidth: 44 }}>
            <KeyboardArrowRightRoundedIcon sx={{
              transform: collapsed ? undefined : 'rotate(90deg)',
            }} />
          </IconButton>
        </Stack>
      </Stack>
      {cards.length ? (
        <Stack id={'xdrive-mobile-gallery-group-content-' + id}
          direction="row" spacing={collapsed ? 0.75 : 1.25} role="list"
          data-xdrive-mobile-gallery-group-collapsed={collapsed ? id : undefined}
          data-xdrive-mobile-gallery-group-tiles={collapsed ? undefined : id}
          sx={{ px: 1.5, pb: 1, overflowX: 'auto',
            overscrollBehaviorX: 'contain', scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' } }}>
          {cards.map((card) => (
            <Box role="listitem" key={card.key}
              data-xdrive-mobile-gallery-card-width={collapsed ? undefined : tileWidth}
              sx={collapsed
                ? { flex: '0 0 auto', minWidth: 0 }
                : { flex: '0 0 ' + tileWidth + 'px', width: tileWidth, minWidth: 0 }}>
              <Button onClick={card.activate} aria-label={card.title}
                data-xdrive-mobile-gallery-collection-card={card.key}
                sx={collapsed ? {
                  minHeight: 44, px: 1.5, borderRadius: 99,
                  bgcolor: 'action.hover', textTransform: 'none',
                } : {
                  p: 0, minWidth: 0, width: '100%',
                  display: 'flex', alignItems: 'stretch', flexDirection: 'column',
                  textTransform: 'none', textAlign: 'left', color: 'text.primary',
                  borderRadius: 2,
                }}>
                {!collapsed ? (
                  <CollectionCover title={card.title} nodeID={card.coverNodeID}
                    loadThumbnail={loadThumbnail} />
                ) : null}
                <Typography variant="body2" fontWeight={650} noWrap
                  sx={{ width: collapsed ? 'auto' : '100%', pt: collapsed ? 0 : 0.75 }}>
                  {card.title}
                </Typography>
                {!collapsed && card.detail ? (
                  <Typography variant="caption" color="text.secondary" noWrap
                    sx={{ width: '100%' }}>{card.detail}</Typography>
                ) : null}
              </Button>
            </Box>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

/** Presentation only: consumes existing Gallery collection data and callbacks. */
export function XDriveMobileGalleryCollections({
  accountScope = '', albums, memories, people, pets, places, syncFolders, loadThumbnail,
  onOpenSection, onOpenAlbum, onOpenMemory, onOpenPerson,
  onOpenPet, onOpenPlace, onOpenSyncFolder,
}: XDriveMobileGalleryCollectionsProps) {
  const open = (section: MediaGallerySection) => () => onOpenSection(section)
  const [layoutAnchor, setLayoutAnchor] = useState<HTMLElement | null>(null)
  const [reorderMode, setReorderMode] = useState(false)
  const [draggingID, setDraggingID] = useState<GalleryCollectionGroupID | null>(null)
  const dragRef = useRef<{ id: GalleryCollectionGroupID; pointerId: number;
    kind: string; started: number; x: number; y: number } | null>(null)
  const [orderState, setOrderState] = useState(() => ({
    accountScope, order: xDriveReadMobileGalleryGroupOrder(accountScope),
  }))
  const groupOrder = orderState.accountScope === accountScope
    ? orderState.order : xDriveReadMobileGalleryGroupOrder(accountScope)
  const currentOrderRef = useRef<GalleryCollectionGroupID[]>(groupOrder)
  currentOrderRef.current = groupOrder
  const updateOrder = (order: GalleryCollectionGroupID[]) => {
    const next = xDriveNormalizeMobileGalleryGroupOrder(order)
    currentOrderRef.current = next
    setOrderState({ accountScope, order: next })
    xDriveWriteMobileGalleryGroupOrder(accountScope, next)
  }
  const [savedPresentation, setSavedPresentation] = useState(() => ({
    accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope),
  }))
  useEffect(() => {
    setSavedPresentation((current) => current.accountScope === accountScope
      ? current : { accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope) })
    setLayoutAnchor(null)
    setReorderMode(false)
    setDraggingID(null)
    dragRef.current = null
    setOrderState((current) => current.accountScope === accountScope
      ? current : { accountScope, order: xDriveReadMobileGalleryGroupOrder(accountScope) })
  }, [accountScope])
  const presentation = savedPresentation.accountScope === accountScope
    ? savedPresentation
    : { accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope) }
  useEffect(() => {
    if (savedPresentation.accountScope !== accountScope) return
    xDriveWriteMobileGalleryCollectionsPresentation(accountScope, savedPresentation)
  }, [accountScope, savedPresentation])
  const changePresentation = (update: Partial<GalleryCollectionsPresentation>) => {
    setSavedPresentation((previous) => {
      const current = previous.accountScope === accountScope
        ? previous : { accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope) }
      return { ...current, ...update }
    })
    setLayoutAnchor(null)
  }
  const toggleCollapsed = (id: GalleryCollectionGroupID) => {
    const collapsed = presentation.collapsed.includes(id)
      ? presentation.collapsed.filter((candidate) => candidate !== id)
      : [...presentation.collapsed, id]
    changePresentation({ collapsed })
  }
  const groupProps = (id: GalleryCollectionGroupID) => ({
    id, layout: presentation.layout,
    collapsed: presentation.collapsed.includes(id),
    onToggleCollapsed: toggleCollapsed,
  })
  // Reuse the exact account-scoped album pin order from the shared Web/Desktop
  // Album Organizer. These are previews only; all pinned albums remain in Albums.
  const pinnedAlbums: CollectionCard[] = onOpenAlbum
    ? sortedMediaAlbums(albums, readMediaAlbumPreferences(accountScope))
        .pinned.slice(0, 8).map((album) => ({
          key: 'pinned-album-' + album.id,
          title: album.name,
          detail: album.item_count.toLocaleString('zh-CN') + ' 项',
          coverNodeID: album.cover_node_id,
          activate: () => onOpenAlbum(album),
        }))
    : []
  const pinned: CollectionCard[] = [
    { key: 'favorites', title: '收藏', activate: open('favorites') },
    { key: 'albums', title: '相册',
      coverNodeID: albums.find((album) => album.cover_node_id)?.cover_node_id,
      activate: open('albums') },
    { key: 'people', title: '人物与宠物',
      coverNodeID: people.find((person) => !person.hidden && person.cover_node_id)?.cover_node_id,
      activate: open('people') },
    { key: 'media-types', title: '媒体类型', activate: open('media-types') },
    ...pinnedAlbums,
  ]
  const recent: CollectionCard[] = onOpenMemory
    ? memories.filter((m) => m.item_count > 0).slice(0, 8)
      .map((m) => ({
      key: 'memory-' + m.id, title: m.title,
      detail: m.subtitle || m.item_count.toLocaleString('zh-CN') + ' 项',
        coverNodeID: m.cover_node_id, activate: () => onOpenMemory(m),
      }))
    : []
  if (!recent.length) {
    recent.push({ key: 'memories', title: '回忆', activate: open('memories') })
  }
  const ownedAlbums: CollectionCard[] = onOpenAlbum
    ? albums.slice(0, 8).map((album) => ({
      key: 'album-' + album.id, title: album.name,
      detail: album.item_count.toLocaleString('zh-CN') + ' 项',
      coverNodeID: album.cover_node_id, activate: () => onOpenAlbum(album),
    }))
    : []
  const identities: CollectionCard[] = onOpenPerson
    ? people.filter((person) => !person.hidden).slice(0, 8).map((person) => ({
      key: 'person-' + person.id, title: person.name || '未命名人物',
      detail: person.item_count.toLocaleString('zh-CN') + ' 项',
      coverNodeID: person.cover_node_id, activate: () => onOpenPerson(person),
    }))
    : []
  if (onOpenPet) {
    identities.push(...pets.slice(0, 4).map((pet) => ({
      key: 'pet-' + pet.id, title: pet.name,
      detail: pet.item_count.toLocaleString('zh-CN') + ' 项',
      coverNodeID: pet.cover_node_id, activate: () => onOpenPet(pet),
    })))
  }
  const placesCards: CollectionCard[] = onOpenPlace
    ? places.slice(0, 8).map((place) => ({
      key: 'place-' + place.id, title: place.name,
      detail: place.item_count.toLocaleString('zh-CN') + ' 项',
      coverNodeID: place.cover_node_id, activate: () => onOpenPlace(place),
    }))
    : []
  const folderCards: CollectionCard[] = onOpenSyncFolder
    ? syncFolders.slice(0, 6).map((folder) => ({
      key: 'source-' + folder.source_id, title: folder.source_name,
      detail: folder.direct_media_count.toLocaleString('zh-CN') + ' 个媒体',
      coverNodeID: folder.cover_node_id, activate: () => onOpenSyncFolder(folder),
    }))
    : []
  const utilities: CollectionCard[] = [
    { key: 'places', title: '地点', activate: open('places') },
    { key: 'cleanup', title: '清理建议', activate: open('cleanup') },
    { key: 'trash', title: '回收站', activate: open('trash') },
  ]

  const groupModels: GalleryCollectionGroupModel[] = [
    { id: 'pinned', title: '固定项目', cards: pinned,
      onViewAll: pinnedAlbums.length ? open('albums') : undefined },
    { id: 'memories', title: '回忆', cards: recent, onViewAll: open('memories') },
    { id: 'albums', title: '相册', cards: ownedAlbums, onViewAll: open('albums') },
    { id: 'people', title: '人物与宠物', cards: identities, onViewAll: open('people') },
    { id: 'places', title: '地点', cards: placesCards,
      onViewAll: placesCards.length ? open('places') : undefined },
    { id: 'sync-folders', title: '同步文件夹', cards: folderCards,
      onViewAll: folderCards.length ? open('albums') : undefined },
    { id: 'utilities', title: '实用工具', cards: utilities },
  ]
  const visibleGroups = groupOrder
    .map((id) => groupModels.find((group) => group.id === id))
    .filter((group): group is GalleryCollectionGroupModel =>
      Boolean(group && (group.cards.length || group.onViewAll)))
  const moveGroup = (source: GalleryCollectionGroupID, target: GalleryCollectionGroupID) =>
    updateOrder(xDriveMoveMobileGalleryGroup(currentOrderRef.current, source, target))
  const shiftGroup = (source: GalleryCollectionGroupID, delta: -1 | 1) => {
    const ids = visibleGroups.map((group) => group.id)
    const index = ids.indexOf(source)
    const target = ids[index + delta]
    if (index >= 0 && target) moveGroup(source, target)
  }
  const enterReorder = () => {
    dragRef.current = null
    setDraggingID(null)
    setLayoutAnchor(null)
    setReorderMode(true)
  }
  const exitReorder = () => {
    dragRef.current = null
    setDraggingID(null)
    setReorderMode(false)
  }
  const startDrag = (id: GalleryCollectionGroupID, e: ReactPointerEvent<HTMLButtonElement>) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || dragRef.current) return
    dragRef.current = {
      id, pointerId: e.pointerId, kind: e.pointerType, started: Date.now(),
      x: e.clientX, y: e.clientY,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDraggingID(id)
  }
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    // Touch requires a 220ms hold, with a 6px dead zone.
    if (active.kind === 'touch' && Date.now() - active.started < 220) return
    if (Math.hypot(e.clientX - active.x, e.clientY - active.y) < 6) return
    const underPointer = typeof document === 'undefined' ? null
      : document.elementFromPoint?.(e.clientX, e.clientY)
        ?.closest<HTMLElement>('[data-xdrive-mobile-gallery-reorder-row]')
    const id = underPointer?.getAttribute('data-xdrive-mobile-gallery-reorder-row')
    if (!id || !visibleGroups.some((group) => group.id === id)) return
    e.preventDefault()
    if (id !== active.id) moveGroup(active.id, id as GalleryCollectionGroupID)
  }
  const stopDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
    setDraggingID(null)
  }



  return (
    <Stack id="xdrive-mobile-gallery-collections" data-xdrive-mobile-gallery-collections
      role="tabpanel" aria-label="精选集"
      spacing={2.75} sx={{ minWidth: 0, pt: 0.75, pb: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="flex-end" sx={{ px: 1.5 }}>
        <Button size="small" data-xdrive-mobile-gallery-layout-trigger
          aria-label="精选集布局" aria-haspopup="menu"
          onClick={(event) => setLayoutAnchor(event.currentTarget)}
          sx={{ minHeight: 44, minWidth: 44 }}>
          <GridViewRoundedIcon fontSize="small" />
          布局
        </Button>
      </Stack>
      <Menu anchorEl={layoutAnchor} open={Boolean(layoutAnchor)}
        onClose={() => setLayoutAnchor(null)} aria-label="精选集布局选项">
        {([
          ['large', '大图标'], ['small', '小图标'], ['mixed', '混合图标'],
        ] as const).map(([mode, label]) => (
          <MenuItem key={mode} data-xdrive-mobile-gallery-layout-option={mode}
            selected={presentation.layout === mode}
            onClick={() => changePresentation({ layout: mode })}
            sx={{ minHeight: 44 }}>{label}</MenuItem>
        ))}
        <MenuItem data-xdrive-mobile-gallery-layout-collapse-all
          onClick={() => changePresentation({ collapsed: [...GROUP_IDS] })}
          sx={{ minHeight: 44 }}>全部折叠</MenuItem>
        <MenuItem data-xdrive-mobile-gallery-layout-expand-all
          onClick={() => changePresentation({ collapsed: [] })}
          sx={{ minHeight: 44 }}>全部展开</MenuItem>
        <MenuItem data-xdrive-mobile-gallery-layout-reorder
          onClick={enterReorder} sx={{ minHeight: 44 }}>重新排序</MenuItem>
      </Menu>
      {reorderMode ? (
        <Stack role="list" data-xdrive-mobile-gallery-reorder-editor
          sx={{ px: 1.5 }} spacing={1}>
          <Typography variant="body2" color="text.secondary">
            按住右侧手柄拖动，也可以使用上移和下移按钮。
          </Typography>
          {visibleGroups.map((group, index) => (
            <Stack role="listitem" key={group.id} direction="row" spacing={0.5}
              alignItems="center" data-xdrive-mobile-gallery-reorder-row={group.id}
              sx={{ px: 1, minHeight: 52, borderRadius: 2,
                bgcolor: draggingID === group.id ? 'action.selected' : 'action.hover' }}>
              <Typography noWrap variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                {group.title}
              </Typography>
              <IconButton aria-label={'上移' + group.title}
                data-xdrive-mobile-gallery-reorder-up={group.id}
                disabled={index === 0} onClick={() => shiftGroup(group.id, -1)}
                sx={{ minHeight: 44, minWidth: 44 }}>
                <ArrowUpwardRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label={'下移' + group.title}
                data-xdrive-mobile-gallery-reorder-down={group.id}
                disabled={index === visibleGroups.length - 1}
                onClick={() => shiftGroup(group.id, 1)}
                sx={{ minHeight: 44, minWidth: 44 }}>
                <ArrowDownwardRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label={'按住并拖动' + group.title + '调整顺序'}
                aria-grabbed={draggingID === group.id}
                data-xdrive-mobile-gallery-reorder-handle={group.id}
                onPointerDown={(event) => startDrag(group.id, event)}
                onPointerMove={moveDrag} onPointerUp={stopDrag}
                onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    shiftGroup(group.id, event.key === 'ArrowUp' ? -1 : 1)
                  }
                }}
                sx={{ minHeight: 44, minWidth: 44, touchAction: 'none', userSelect: 'none' }}>
                <DragIndicatorRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button data-xdrive-mobile-gallery-reorder-done
            onClick={exitReorder} sx={{ minHeight: 44 }}>完成</Button>
        </Stack>
      ) : (
        <>
          {visibleGroups.map((group) => (
            <CollectionGroup key={group.id} {...groupProps(group.id)}
              title={group.title} cards={group.cards} loadThumbnail={loadThumbnail}
              onViewAll={group.onViewAll} />
          ))}
          <Button data-xdrive-mobile-gallery-reorder-bottom
            onClick={enterReorder} sx={{ minHeight: 44, mx: 1.5, alignSelf: 'flex-start' }}>
            重新排序精选集
          </Button>
        </>
      )}
    </Stack>
  )
}
