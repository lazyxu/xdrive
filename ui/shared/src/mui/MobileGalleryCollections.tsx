import { useEffect, useRef, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import type {
  MediaAlbum, MediaMemory, MediaPersonIdentity, MediaPetFacet,
  MediaPlaceFacet, MediaSyncFolder,
} from '../models'
import type { MediaThumbnailLoader } from './MediaGallery'
import type { MediaGallerySection } from './MediaGalleryNavigation'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

type CollectionCard = {
  key: string
  title: string
  detail?: string
  coverNodeID?: number
  activate: () => void
}

export interface XDriveMobileGalleryCollectionsProps {
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
  title, cards, loadThumbnail, onViewAll,
}: { title: string; cards: readonly CollectionCard[]; loadThumbnail: MediaThumbnailLoader; onViewAll?: () => void }) {
  if (!cards.length && !onViewAll) return null
  return (
    <Stack spacing={1} data-xdrive-mobile-gallery-collection-group={title}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5 }}>
        <Typography component="h3" fontWeight={750} variant="h6">
          {title}
        </Typography>
        {onViewAll ? (
          <Button size="small" data-xdrive-mobile-gallery-view-all={title}
            aria-label={'查看全部' + title}
            onClick={onViewAll} sx={{ minHeight: 44, minWidth: 72 }}>
            查看全部
          </Button>
        ) : null}
      </Stack>
      {cards.length ? (
        <Stack direction="row" spacing={1.25} role="list"
        sx={{ px: 1.5, pb: 1, overflowX: 'auto',
          overscrollBehaviorX: 'contain', scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' } }}>
        {cards.map((card) => (
          <Box role="listitem" key={card.key} sx={{ flex: '0 0 144px', width: 144, minWidth: 0 }}>
            <Button onClick={card.activate} aria-label={card.title}
              data-xdrive-mobile-gallery-collection-card={card.key}
              sx={{
                p: 0, minWidth: 0, width: '100%',
                display: 'flex', alignItems: 'stretch', flexDirection: 'column',
                textTransform: 'none', textAlign: 'left', color: 'text.primary',
                borderRadius: 2,
              }}>
              <CollectionCover title={card.title} nodeID={card.coverNodeID}
                loadThumbnail={loadThumbnail} />
              <Typography variant="body2" fontWeight={650} noWrap sx={{ width: '100%', pt: 0.75 }}>
                {card.title}
              </Typography>
              {card.detail ? (
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
  albums, memories, people, pets, places, syncFolders, loadThumbnail,
  onOpenSection, onOpenAlbum, onOpenMemory, onOpenPerson,
  onOpenPet, onOpenPlace, onOpenSyncFolder,
}: XDriveMobileGalleryCollectionsProps) {
  const open = (section: MediaGallerySection) => () => onOpenSection(section)
  const pinned: CollectionCard[] = [
    { key: 'favorites', title: '收藏', activate: open('favorites') },
    { key: 'albums', title: '相册',
      coverNodeID: albums.find((album) => album.cover_node_id)?.cover_node_id,
      activate: open('albums') },
    { key: 'people', title: '人物与宠物',
      coverNodeID: people.find((person) => !person.hidden && person.cover_node_id)?.cover_node_id,
      activate: open('people') },
    { key: 'media-types', title: '媒体类型', activate: open('media-types') },
  ]
  const recent: CollectionCard[] = onOpenMemory
    ? memories.slice(0, 8).filter((m) => m.item_count > 0)
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
      <CollectionGroup title="固定项目" cards={pinned} loadThumbnail={loadThumbnail} />
      <CollectionGroup title="回忆" cards={recent} loadThumbnail={loadThumbnail} onViewAll={open('memories')} />
      <CollectionGroup title="相册" cards={ownedAlbums} loadThumbnail={loadThumbnail} onViewAll={open('albums')} />
      <CollectionGroup title="人物与宠物" cards={identities} loadThumbnail={loadThumbnail} onViewAll={open('people')} />
      <CollectionGroup title="地点" cards={placesCards} loadThumbnail={loadThumbnail} onViewAll={placesCards.length ? open('places') : undefined} />
      <CollectionGroup title="同步文件夹" cards={folderCards} loadThumbnail={loadThumbnail} onViewAll={folderCards.length ? open('albums') : undefined} />
      <CollectionGroup title="实用工具" cards={utilities} loadThumbnail={loadThumbnail} />
    </Stack>
  )
}
