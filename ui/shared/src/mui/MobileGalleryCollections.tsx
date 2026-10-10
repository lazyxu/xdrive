import { useEffect, useRef, useState } from 'react'
import { Box, Button, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
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
  const [savedPresentation, setSavedPresentation] = useState(() => ({
    accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope),
  }))
  useEffect(() => {
    setSavedPresentation((current) => current.accountScope === accountScope
      ? current : { accountScope, ...xDriveReadMobileGalleryCollectionsPresentation(accountScope) })
    setLayoutAnchor(null)
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
      </Menu>
      <CollectionGroup {...groupProps('pinned')} title="固定项目" cards={pinned}
        loadThumbnail={loadThumbnail} onViewAll={pinnedAlbums.length ? open('albums') : undefined} />
      <CollectionGroup {...groupProps('memories')} title="回忆" cards={recent}
        loadThumbnail={loadThumbnail} onViewAll={open('memories')} />
      <CollectionGroup {...groupProps('albums')} title="相册" cards={ownedAlbums}
        loadThumbnail={loadThumbnail} onViewAll={open('albums')} />
      <CollectionGroup {...groupProps('people')} title="人物与宠物" cards={identities}
        loadThumbnail={loadThumbnail} onViewAll={open('people')} />
      <CollectionGroup {...groupProps('places')} title="地点" cards={placesCards}
        loadThumbnail={loadThumbnail} onViewAll={placesCards.length ? open('places') : undefined} />
      <CollectionGroup {...groupProps('sync-folders')} title="同步文件夹" cards={folderCards}
        loadThumbnail={loadThumbnail} onViewAll={folderCards.length ? open('albums') : undefined} />
      <CollectionGroup {...groupProps('utilities')} title="实用工具" cards={utilities}
        loadThumbnail={loadThumbnail} />
    </Stack>
  )
}
