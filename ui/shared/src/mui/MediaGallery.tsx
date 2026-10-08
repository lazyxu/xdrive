import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowBack as ArrowBackIcon,
  Collections as CollectionsIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  PersonOutline as PersonOutlineIcon,
  Refresh as RefreshIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type {
  XDriveByteProgressHandler,
  XDriveLivePhotoMotionSource,
} from '../file-preview'
import type { XDriveWebAppGalleryTarget } from '../web-app'
import type {
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaItemRange,
  MediaMemory,
  MediaPetFacet,
  MediaPersonSuggestionReview,
  MediaDuplicateGroup,
  MediaDuplicateGroupList,
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaBurstReview,
  MediaBurstReviewList,
  MediaPersonIdentity,
  MediaPersonSplit,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  MediaTimelineGroupIndex,
  MediaTimelineGroupSets,
  UpdateMediaPersonIdentityInput,
} from '../models'
import { XDriveDialogContent } from './DialogContent'
import {
  XDriveMediaGalleryFilterToolbar,
  emptyMediaGalleryFilterDraft,
  hasMediaGalleryFilters,
  mediaGalleryDraftFromQuery,
  mediaGalleryQueryFromDraft,
} from './MediaGalleryFilters'
import type { MediaGalleryFilterDraft } from './MediaGalleryFilters'
import {
  XDriveMediaGalleryNavigation,
} from './MediaGalleryNavigation'
import type { MediaGallerySection } from './MediaGalleryNavigation'
import { XDriveMediaGalleryPlacesMap } from './MediaGalleryPlacesMap'
import { XDriveMediaGalleryMemories } from './MediaGalleryMemories'
import { XDriveMediaGalleryCleanup } from './MediaGalleryCleanup'
import { XDriveMediaGalleryPets } from './MediaGalleryPets'
import { XDriveMediaGallerySelectionToolbar } from './MediaGallerySelectionToolbar'
import {
  XDriveMediaGalleryCollageDialog,
  xDriveMediaItemSupportsCollage,
} from './MediaGalleryCollageDialog'
import {
  XDriveMediaGalleryMovieDialog,
  xDriveMediaItemSupportsAutoMovie,
} from './MediaGalleryMovieDialog'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveMediaDetailsInspector } from './MediaGalleryInspector'
import { XDriveMediaGalleryViewer } from './MediaGalleryViewer'
import { XDriveLivePhotoGlyph } from './LivePhotoSurface'
import { XDriveShareDialog } from './ShareDialog'
import type { XDriveShareDialogAdapter } from './ShareDialog'
import {
  XDriveMediaAsyncThumbnail,
  XDriveMediaAsyncVideoPoster,
  xDriveMediaFallback,
} from './MediaGalleryPreviewMedia'
import {
  xDriveMediaFormatDuration,
  xDriveMediaGalleryErrorMessage,
} from './MediaGalleryUtils'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { useXDriveVirtualCollection } from './VirtualCollectionController'
import {
  XDRIVE_MEDIA_GALLERY_GRID_GAP,
  xDriveMediaGalleryGridMetrics,
  xDriveMediaGalleryGridWindow,
} from './MediaGalleryVirtualGrid'
import {
  XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP,
  xDriveMediaGalleryTimelineIndexVisible,
  xDriveMediaGalleryTimelineLayout,
  xDriveMediaGalleryTimelineWindow,
} from './MediaGalleryVirtualTimeline'
import {
  XDriveMediaThumbnailScheduler,
} from './MediaGalleryThumbnailScheduler'
import type {
  XDriveMediaThumbnailPriority,
} from './MediaGalleryThumbnailScheduler'

export type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>
export type MediaMotionLoader = (
  nodeID: number,
  onProgress?: XDriveByteProgressHandler,
) => Promise<XDriveLivePhotoMotionSource | null>
export type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video' | 'live_photo',
) => Promise<string | null>

export interface MediaGalleryDataSource {
  listItems: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listItemRange: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItemRange>
  listTrashItemRange?: (
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  restoreTrashItems?: (items: MediaItem[]) => Promise<void>
  permanentlyDeleteTrashItems?: (items: MediaItem[]) => Promise<void>
  listAlbums: () => Promise<MediaAlbum[]>
  listPlaces?: (limit?: number) => Promise<MediaPlaceFacet[]>
  listMemories?: (anchorDate?: string, limit?: number) => Promise<MediaMemory[]>
  listMemoryItemRange?: (
    memoryID: string,
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  listDuplicateGroups?: (limit?: number) => Promise<MediaDuplicateGroupList>
  listDuplicateItemRange?: (
    duplicateID: string,
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  listBurstReviews?: (limit?: number) => Promise<MediaBurstReviewList>
  listBurstReviewItemRange?: (
    burstID: string,
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  listPets?: () => Promise<MediaPetFacet[]>
  listPetItemRange?: (
    petKind: string,
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  listSuggestedPeople?: (
    includeReviewed?: boolean,
    limit?: number,
  ) => Promise<MediaSuggestedPerson[]>
  listSuggestedPersonItems?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listSuggestedPersonItemRange?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItemRange>
  listPeople?: (
    includeHidden?: boolean,
    limit?: number,
    offset?: number,
  ) => Promise<MediaPersonIdentity[]>
  listPersonItems?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listPersonItemRange?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItemRange>
  reviewSuggestedPerson?: (
    suggestionID: string,
    state: 'pending' | 'dismissed',
  ) => Promise<MediaPersonSuggestionReview>
  addSuggestedPersonToPerson?: (
    suggestionID: string,
    personID: string,
    revision: number,
  ) => Promise<MediaPersonIdentity>
  adoptSuggestedPerson?: (
    suggestionID: string,
    name: string,
  ) => Promise<MediaPersonIdentity>
  updatePerson?: (
    personID: string,
    revision: number,
    input: UpdateMediaPersonIdentityInput,
  ) => Promise<MediaPersonIdentity>
  mergePeople?: (
    targetID: string,
    revision: number,
    sourceIDs: string[],
  ) => Promise<MediaPersonIdentity>
  splitPerson?: (
    personID: string,
    revision: number,
    nodeIDs: number[],
    name: string,
  ) => Promise<MediaPersonSplit>
  listAlbumItems: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listAlbumItemRange: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItemRange>
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  setFavorite?: (nodeID: number, favorite: boolean) => Promise<void>
  setFavoriteBatch?: (nodeIDs: number[], favorite: boolean) => Promise<void>
  addTagsBatch?: (nodeIDs: number[], tags: string[]) => Promise<void>
  deleteItems?: (items: MediaItem[]) => Promise<void>
  downloadItems?: (items: MediaItem[]) => Promise<void>
  setTags?: (nodeID: number, tags: string[]) => Promise<string[]>
  setPeople?: (nodeID: number, people: string[]) => Promise<string[]>
  setDescription?: (nodeID: number, description: string) => Promise<string>
  saveEditRecipe?: (
    nodeID: number,
    input: MediaEditRecipeInput,
  ) => Promise<MediaEditRecipe>
  resetEditRecipe?: (
    nodeID: number,
    revision: number,
  ) => Promise<MediaEditRecipe>
  createCreativeGeneration?: (
    nodeID: number,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  getCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  cancelCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  createAlbum?: (name: string) => Promise<MediaAlbum>
  createSmartAlbum?: (name: string, query: MediaGalleryQuery) => Promise<MediaAlbum>
  updateSmartAlbum?: (
    albumID: string,
    revision: number,
    input: { name?: string; query?: MediaGalleryQuery },
  ) => Promise<MediaAlbum>
  deleteSmartAlbum?: (albumID: string, revision: number) => Promise<void>
  renameAlbum?: (albumID: string, revision: number, name: string) => Promise<MediaAlbum>
  deleteAlbum?: (albumID: string, revision: number) => Promise<void>
  addToAlbum?: (albumID: string, revision: number, nodeIDs: number[]) => Promise<MediaAlbum>
  removeFromAlbum?: (albumID: string, revision: number, nodeID: number) => Promise<MediaAlbum>
}

export type MediaCleanupReviewTarget =
  | { kind: 'duplicate'; group: MediaDuplicateGroup }
  | { kind: 'burst'; group: MediaBurstReview }

type MediaGalleryCollectionTarget = XDriveWebAppGalleryTarget & {
  requestID: number
}

export type XDriveMediaGalleryOpenViewerContext = {
  target: XDriveWebAppGalleryTarget
  activeIndex: number
  totalCount: number
}

function mediaGalleryQuerySignature(query: MediaGalleryQuery) {
  return JSON.stringify(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function mediaGalleryCollectionKey(target: MediaGalleryCollectionTarget | null) {
  if (!target) return 'media-gallery:idle'
  return [
    'media-gallery',
    target.kind,
    target.id ?? '',
    mediaGalleryQuerySignature(target.query),
    target.requestID,
  ].join(':')
}

function mediaGalleryTarget(
  requestID: number,
  album: MediaAlbum | null,
  query: MediaGalleryQuery,
  suggestedPerson: MediaSuggestedPerson | null,
  person: MediaPersonIdentity | null,
): MediaGalleryCollectionTarget {
  if (person) return { kind: 'person', id: person.id, query, requestID }
  if (suggestedPerson) return { kind: 'suggested-person', id: suggestedPerson.id, query, requestID }
  if (album) return { kind: 'album', id: album.id, query, requestID }
  return { kind: 'all', query, requestID }
}

function mediaGallerySectionDraft(
  section: MediaGallerySection,
  activeMediaType = '',
): MediaGalleryFilterDraft {
  if (section === 'favorites') {
    return { ...emptyMediaGalleryFilterDraft, favorite: 'favorite' }
  }
  if (section === 'media-types' && activeMediaType) {
    if (activeMediaType === 'gif' || activeMediaType === 'panorama') {
      return { ...emptyMediaGalleryFilterDraft, category: activeMediaType }
    }
    return { ...emptyMediaGalleryFilterDraft, assetKind: activeMediaType }
  }
  return emptyMediaGalleryFilterDraft
}

export function xDriveMediaGalleryUTCDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function emptyMediaTimelineGroupSets(): MediaTimelineGroupSets {
  return { year: [], month: [], day: [] }
}

function emptyMediaDuplicateGroupList(): MediaDuplicateGroupList {
  return {
    groups: [],
    total_groups: 0,
    total_items: 0,
    logical_duplicate_bytes: 0,
    physical_reclaimable_bytes: 0,
  }
}

function emptyMediaBurstReviewList(): MediaBurstReviewList {
  return {
    groups: [],
    total_groups: 0,
    total_items: 0,
    potential_cleanup_bytes: 0,
    physical_reclaimable_bytes: 0,
  }
}

function mediaTimelineGroupSetsFromRange(range: MediaItemRange): MediaTimelineGroupSets {
  return {
    year: range.timeline_group_sets?.year ?? [],
    month: range.timeline_group_sets?.month ?? range.timeline_groups ?? [],
    day: range.timeline_group_sets?.day ?? [],
  }
}

export type XDriveMediaGalleryShareDialogOptions = {
  adapter: XDriveShareDialogAdapter
  expiryMode?: 'datetime' | 'days'
  listVariant?: 'table' | 'compact'
  showCloseAction?: boolean
}

export interface XDriveMediaGalleryPageProps {
  source: MediaGalleryDataSource
  pageSize?: number
  shareDialog?: XDriveMediaGalleryShareDialogOptions
  initialSection?: MediaGallerySection
  onSectionRouteChange?: (section: MediaGallerySection) => void
  onOpenViewer?: (item: MediaItem, context: XDriveMediaGalleryOpenViewerContext) => void
  onError?: (error: unknown) => void
}

export function XDriveMediaGalleryPage({
  source,
  pageSize = 100,
  shareDialog,
  initialSection,
  onSectionRouteChange,
  onOpenViewer,
  onError,
}: XDriveMediaGalleryPageProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([])
  const [places, setPlaces] = useState<MediaPlaceFacet[]>([])
  const [memories, setMemories] = useState<MediaMemory[]>([])
  const [duplicateGroups, setDuplicateGroups] =
    useState<MediaDuplicateGroupList | null>(null)
  const [burstReviews, setBurstReviews] =
    useState<MediaBurstReviewList | null>(null)
  const [pets, setPets] = useState<MediaPetFacet[]>([])
  const [suggestedPeople, setSuggestedPeople] = useState<MediaSuggestedPerson[]>([])
  const [people, setPersonIdentities] = useState<MediaPersonIdentity[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [timelineGroupSets, setTimelineGroupSets] = useState<MediaTimelineGroupSets>(
    emptyMediaTimelineGroupSets,
  )
  const [currentAlbum, setCurrentAlbum] = useState<MediaAlbum | null>(null)
  const [currentSuggestedPerson, setCurrentSuggestedPerson] =
    useState<MediaSuggestedPerson | null>(null)
  const [currentPerson, setCurrentPerson] = useState<MediaPersonIdentity | null>(null)
  const [currentPet, setCurrentPet] = useState<MediaPetFacet | null>(null)
  const [currentMemory, setCurrentMemory] = useState<MediaMemory | null>(null)
  const [currentCleanupReview, setCurrentCleanupReview] =
    useState<MediaCleanupReviewTarget | null>(null)
  const routeSectionAppliedRef = useRef<MediaGallerySection | null>(null)
  const [section, setSection] = useState<MediaGallerySection>(initialSection ?? 'library')
  const [activeMediaType, setActiveMediaType] = useState('')
  const [draftFilters, setDraftFilters] = useState<MediaGalleryFilterDraft>(
    emptyMediaGalleryFilterDraft,
  )
  const [query, setQuery] = useState<MediaGalleryQuery>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [smartDialogOpen, setSmartDialogOpen] = useState(false)
  const [smartAlbumName, setSmartAlbumName] = useState('')
  const [smartDialogBusy, setSmartDialogBusy] = useState(false)
  const [smartDialogError, setSmartDialogError] = useState('')
  const [shareItem, setShareItem] = useState<MediaItem | null>(null)
  const requestID = useRef(0)
  const placesExpandedRef = useRef(false)
  const collectionTargetRef = useRef<MediaGalleryCollectionTarget | null>(null)
  const [collectionTarget, setCollectionTarget] = useState<MediaGalleryCollectionTarget | null>(null)

  const reportError = useCallback((loadError: unknown) => {
    const message = xDriveMediaGalleryErrorMessage(loadError)
    setError(message)
    onError?.(loadError)
  }, [onError])

  const loadTargetRange = useCallback(async (
    target: MediaGalleryCollectionTarget,
    offset: number,
    limit: number,
  ): Promise<MediaItemRange> => {
    switch (target.kind) {
      case 'trash':
        if (!source.listTrashItemRange) {
          throw new Error('当前客户端不支持图库回收站')
        }
        return source.listTrashItemRange(limit, offset)
      case 'person':
        if (!target.id || !source.listPersonItemRange) {
          throw new Error('当前客户端不支持人物图库范围加载')
        }
        return source.listPersonItemRange(target.id, limit, offset, target.query)
      case 'memory':
        if (!target.id || !source.listMemoryItemRange) {
          throw new Error('当前客户端不支持回忆范围加载')
        }
        return source.listMemoryItemRange(target.id, limit, offset)
      case 'duplicate-review':
        if (!target.id || !source.listDuplicateItemRange) {
          throw new Error('当前客户端不支持重复项审查范围加载')
        }
        return source.listDuplicateItemRange(target.id, limit, offset)
      case 'burst-review':
        if (!target.id || !source.listBurstReviewItemRange) {
          throw new Error('当前客户端不支持连拍审查范围加载')
        }
        return source.listBurstReviewItemRange(target.id, limit, offset)
      case 'pet':
        if (!target.id || !source.listPetItemRange) {
          throw new Error('当前客户端不支持宠物集合范围加载')
        }
        return source.listPetItemRange(target.id, limit, offset)
      case 'suggested-person':
        if (!target.id || !source.listSuggestedPersonItemRange) {
          throw new Error('当前客户端不支持人物建议范围加载')
        }
        return source.listSuggestedPersonItemRange(target.id, limit, offset, target.query)
      case 'album':
        if (!target.id) throw new Error('相册 ID 缺失')
        return source.listAlbumItemRange(target.id, limit, offset, target.query)
      default:
        return source.listItemRange(limit, offset, target.query)
    }
  }, [source])

  const loadVirtualRange = useCallback(async (
    range: { offset: number; limit: number },
  ) => {
    const target = collectionTargetRef.current
    if (!target) {
      return {
        items: [] as MediaItem[],
        totalCount: 0,
        offset: range.offset,
        limit: range.limit,
      }
    }
    const page = await loadTargetRange(target, range.offset, range.limit)
    if (
      range.offset === 0 &&
      collectionTargetRef.current?.requestID === target.requestID
    ) {
      setTimelineGroupSets(mediaTimelineGroupSetsFromRange(page))
    }
    return {
      items: page.items,
      totalCount: page.total_count,
      offset: page.offset,
      limit: page.limit,
    }
  }, [loadTargetRange])

  const virtualCollection = useXDriveVirtualCollection<MediaItem>({
    queryKey: mediaGalleryCollectionKey(collectionTarget),
    loadRange: loadVirtualRange,
    onError: reportError,
    pageSize,
  })

  const galleryVirtualCollection = useMemo<XDriveMediaGalleryVirtualCollection>(() => ({
    itemCount: virtualCollection.totalCount ?? items.length,
    loadedItems: virtualCollection.loadedItems,
    itemAt: virtualCollection.itemAt,
    onRangeChange: virtualCollection.ensureViewport,
  }), [
    items.length,
    virtualCollection.ensureViewport,
    virtualCollection.itemAt,
    virtualCollection.loadedItems,
    virtualCollection.totalCount,
  ])

  const replaceAlbum = useCallback((next: MediaAlbum) => {
    setAlbums((current) => current.map((album) => album.id === next.id ? next : album))
    setCurrentAlbum((current) => current?.id === next.id ? next : current)
  }, [])

  const replacePerson = useCallback((next: MediaPersonIdentity) => {
    setPersonIdentities((current) => [
      next,
      ...current.filter((person) => person.id !== next.id),
    ])
    setCurrentPerson((current) => current?.id === next.id ? next : current)
  }, [])

  const listAllPeople = useCallback(async () => {
    if (!source.listPeople) return [] as MediaPersonIdentity[]
    const all: MediaPersonIdentity[] = []
    const batchSize = 100
    for (let offset = 0; offset < 5000; offset += batchSize) {
      const page = await source.listPeople(true, batchSize, offset)
      all.push(...page)
      if (page.length < batchSize) break
    }
    return all
  }, [source])

  const loadFirstPage = useCallback(async (
    album: MediaAlbum | null,
    nextQuery: MediaGalleryQuery,
    suggestedPerson: MediaSuggestedPerson | null = null,
    person: MediaPersonIdentity | null = null,
    targetKind: 'default' | 'trash' = 'default',
    memory: MediaMemory | null = null,
    cleanupReview: MediaCleanupReviewTarget | null = null,
    pet: MediaPetFacet | null = null,
  ) => {
    const request = ++requestID.current
    const target: MediaGalleryCollectionTarget = targetKind === 'trash'
      ? { kind: 'trash', query: {}, requestID: request }
      : cleanupReview
        ? {
            kind: cleanupReview.kind === 'duplicate'
              ? 'duplicate-review'
              : 'burst-review',
            id: cleanupReview.group.id,
            query: {},
            requestID: request,
          }
        : memory
          ? { kind: 'memory', id: memory.id, query: {}, requestID: request }
          : pet
            ? { kind: 'pet', id: pet.id, query: {}, requestID: request }
            : mediaGalleryTarget(
          request,
          album,
          nextQuery,
          suggestedPerson,
          person,
        )
    collectionTargetRef.current = target
    setCollectionTarget(target)
    setTimelineGroupSets(emptyMediaTimelineGroupSets())
    virtualCollection.reset(mediaGalleryCollectionKey(target))
    setLoading(true)
    setError('')
    try {
      const rangePromise = loadTargetRange(target, 0, pageSize)
      if (target.kind === 'all') {
        const [
          range,
          nextAlbums,
          nextPlaces,
          nextPets,
          nextSuggestedPeople,
          nextPeople,
        ] = await Promise.all([
          rangePromise,
          source.listAlbums(),
          source.listPlaces
            ? source.listPlaces(placesExpandedRef.current ? 1000 : 24)
            : Promise.resolve([]),
          source.listPets ? source.listPets() : Promise.resolve([]),
          source.listSuggestedPeople
            ? source.listSuggestedPeople(true, 100)
            : Promise.resolve([]),
          listAllPeople(),
        ])
        if (
          request !== requestID.current ||
          collectionTargetRef.current?.requestID !== request
        ) return
        setCurrentAlbum(null)
        setCurrentSuggestedPerson(null)
        setCurrentPerson(null)
        setCurrentPet(null)
        setCurrentMemory(null)
        setCurrentCleanupReview(null)
        setAlbums(nextAlbums)
        setPlaces(nextPlaces)
        setPets(nextPets)
        setSuggestedPeople(
          nextSuggestedPeople.filter((item) => item.review_state !== 'accepted'),
        )
        setPersonIdentities(nextPeople)
        setItems([...range.items])
        setTimelineGroupSets(mediaTimelineGroupSetsFromRange(range))
        virtualCollection.primePage({
          items: range.items,
          totalCount: range.total_count,
          offset: range.offset,
          limit: range.limit,
        })
        return
      }

      const range = await rangePromise
      if (
        request !== requestID.current ||
        collectionTargetRef.current?.requestID !== request
      ) return
      setCurrentAlbum(target.kind === 'album' ? album : null)
      setCurrentSuggestedPerson(
        target.kind === 'suggested-person' ? suggestedPerson : null,
      )
      setCurrentPerson(target.kind === 'person' ? person : null)
      setCurrentPet(target.kind === 'pet' ? pet : null)
      setCurrentMemory(target.kind === 'memory' ? memory : null)
      setCurrentCleanupReview(
        target.kind === 'duplicate-review' || target.kind === 'burst-review'
          ? cleanupReview
          : null,
      )
      setItems([...range.items])
      setTimelineGroupSets(mediaTimelineGroupSetsFromRange(range))
      virtualCollection.primePage({
        items: range.items,
        totalCount: range.total_count,
        offset: range.offset,
        limit: range.limit,
      })
    } catch (loadError) {
      if (
        request !== requestID.current ||
        collectionTargetRef.current?.requestID !== request
      ) return
      reportError(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [
    listAllPeople,
    loadTargetRange,
    pageSize,
    reportError,
    source,
    virtualCollection.primePage,
    virtualCollection.reset,
  ])

  const loadMemories = useCallback(async () => {
    if (!source.listMemories) {
      setMemories([])
      setError('当前客户端不支持回忆')
      return
    }
    const request = ++requestID.current
    collectionTargetRef.current = null
    setCollectionTarget(null)
    setCurrentAlbum(null)
    setCurrentSuggestedPerson(null)
    setCurrentPerson(null)
    setCurrentMemory(null)
    setItems([])
    setTimelineGroupSets(emptyMediaTimelineGroupSets())
    virtualCollection.reset(`media-gallery:memories:index:${request}`)
    setLoading(true)
    setError('')
    try {
      const nextMemories = await source.listMemories(
        xDriveMediaGalleryUTCDateKey(),
        48,
      )
      if (request !== requestID.current) return
      setMemories(nextMemories)
    } catch (loadError) {
      if (request !== requestID.current) return
      reportError(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [reportError, source, virtualCollection.reset])

  const loadCleanup = useCallback(async () => {
    if (!source.listDuplicateGroups && !source.listBurstReviews) {
      setDuplicateGroups(emptyMediaDuplicateGroupList())
      setBurstReviews(emptyMediaBurstReviewList())
      setError('当前客户端不支持图库清理建议')
      return
    }
    const request = ++requestID.current
    collectionTargetRef.current = null
    setCollectionTarget(null)
    setCurrentAlbum(null)
    setCurrentSuggestedPerson(null)
    setCurrentPerson(null)
    setCurrentMemory(null)
    setCurrentCleanupReview(null)
    setItems([])
    setTimelineGroupSets(emptyMediaTimelineGroupSets())
    virtualCollection.reset(`media-gallery:cleanup:index:${request}`)
    setLoading(true)
    setError('')
    try {
      const [nextDuplicates, nextBursts] = await Promise.all([
        source.listDuplicateGroups
          ? source.listDuplicateGroups(48)
          : Promise.resolve(emptyMediaDuplicateGroupList()),
        source.listBurstReviews
          ? source.listBurstReviews(48)
          : Promise.resolve(emptyMediaBurstReviewList()),
      ])
      if (request !== requestID.current) return
      setDuplicateGroups(nextDuplicates)
      setBurstReviews(nextBursts)
    } catch (loadError) {
      if (request !== requestID.current) return
      reportError(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [reportError, source, virtualCollection.reset])

  const selectSection = useCallback((nextSection: MediaGallerySection) => {
    onSectionRouteChange?.(nextSection)
    setCurrentPet(null)
    if (nextSection !== 'memories') setCurrentMemory(null)
    if (nextSection !== 'cleanup') setCurrentCleanupReview(null)
    if (nextSection === 'memories') {
      placesExpandedRef.current = false
      setSection(nextSection)
      setActiveMediaType('')
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      void loadMemories()
      return
    }
    if (nextSection === 'cleanup') {
      placesExpandedRef.current = false
      setSection(nextSection)
      setActiveMediaType('')
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      void loadCleanup()
      return
    }
    placesExpandedRef.current = nextSection === 'places'
    setSection(nextSection)
    setActiveMediaType('')
    const nextDraft = mediaGallerySectionDraft(nextSection)
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    if (nextSection === 'trash') {
      void loadFirstPage(null, {}, null, null, 'trash')
      return
    }
    void loadFirstPage(null, nextQuery)
  }, [loadCleanup, loadFirstPage, loadMemories, onSectionRouteChange])

  const applyFilters = useCallback(() => {
    const nextQuery = mediaGalleryQueryFromDraft(draftFilters)
    if (currentAlbum?.kind === 'smart') {
      if (!source.updateSmartAlbum || !currentAlbum.revision) {
        setError('当前客户端不支持编辑智能相册')
        return
      }
      if (!hasMediaGalleryFilters(draftFilters)) {
        setError('智能相册至少需要一个筛选条件')
        return
      }
      setError('')
      void source.updateSmartAlbum(
        currentAlbum.id,
        currentAlbum.revision,
        { query: nextQuery },
      ).then(async (updated) => {
        replaceAlbum(updated)
        setDraftFilters(mediaGalleryDraftFromQuery(updated.query))
        setQuery({})
        await loadFirstPage(updated, {})
      }).catch((updateError) => {
        const message = xDriveMediaGalleryErrorMessage(updateError)
        setError(message)
        onError?.(updateError)
      })
      return
    }
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [
    currentAlbum,
    currentPerson,
    currentSuggestedPerson,
    draftFilters,
    loadFirstPage,
    onError,
    replaceAlbum,
    source,
  ])

  const clearFilters = useCallback(() => {
    if (currentAlbum?.kind === 'smart') {
      setDraftFilters(mediaGalleryDraftFromQuery(currentAlbum.query))
      setQuery({})
      void loadFirstPage(currentAlbum, {})
      return
    }
    const baseDraft = mediaGallerySectionDraft(section, activeMediaType)
    const nextDraft = currentPerson
      ? { ...baseDraft, personIdentity: currentPerson.id }
      : baseDraft
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [
    activeMediaType,
    currentAlbum,
    currentPerson,
    currentSuggestedPerson,
    loadFirstPage,
    section,
  ])

  const createAlbum = useCallback(async (name: string) => {
    if (!source.createAlbum) throw new Error('当前客户端不支持创建相册')
    const created = await source.createAlbum(name)
    setAlbums((current) => [created, ...current.filter((album) => album.id !== created.id)])
    return created
  }, [source])

  const renameAlbum = useCallback(async (album: MediaAlbum, name: string) => {
    if (!album.revision) throw new Error('当前相册不可重命名')
    const updated = album.kind === 'smart'
      ? source.updateSmartAlbum
        ? await source.updateSmartAlbum(album.id, album.revision, { name })
        : (() => { throw new Error('当前客户端不支持编辑智能相册') })()
      : source.renameAlbum
        ? await source.renameAlbum(album.id, album.revision, name)
        : (() => { throw new Error('当前相册不可重命名') })()
    replaceAlbum(updated)
    return updated
  }, [replaceAlbum, source])

  const deleteAlbum = useCallback(async (album: MediaAlbum) => {
    if (!album.revision) throw new Error('当前相册不可删除')
    if (album.kind === 'smart') {
      if (!source.deleteSmartAlbum) throw new Error('当前客户端不支持删除智能相册')
      await source.deleteSmartAlbum(album.id, album.revision)
    } else {
      if (!source.deleteAlbum) throw new Error('当前相册不可删除')
      await source.deleteAlbum(album.id, album.revision)
    }
    setAlbums((current) => current.filter((value) => value.id !== album.id))
    if (currentAlbum?.id === album.id) {
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      await loadFirstPage(null, {})
    }
  }, [currentAlbum?.id, loadFirstPage, source])

  const addToAlbum = useCallback(async (album: MediaAlbum, item: MediaItem) => {
    if (!source.addToAlbum || !album.revision) throw new Error('当前相册不可编辑')
    const updated = await source.addToAlbum(album.id, album.revision, [item.node.id])
    replaceAlbum(updated)
    return updated
  }, [replaceAlbum, source])

  const removeFromAlbum = useCallback(async (album: MediaAlbum, item: MediaItem) => {
    if (!source.removeFromAlbum || !album.revision) throw new Error('当前相册不可编辑')
    const updated = await source.removeFromAlbum(album.id, album.revision, item.node.id)
    replaceAlbum(updated)
    if (currentAlbum?.id === album.id) {
      await loadFirstPage(updated, query)
    }
    return updated
  }, [currentAlbum?.id, loadFirstPage, query, replaceAlbum, source])

  const createSmartAlbum = useCallback(async (name: string) => {
    if (!source.createSmartAlbum) throw new Error('当前客户端不支持智能相册')
    if (!hasMediaGalleryFilters(draftFilters)) {
      throw new Error('至少需要一个筛选条件才能创建智能相册')
    }
    const created = await source.createSmartAlbum(
      name,
      mediaGalleryQueryFromDraft(draftFilters),
    )
    setAlbums((current) => [
      created,
      ...current.filter((album) => album.id !== created.id),
    ])
    return created
  }, [draftFilters, source])

  const openMemory = useCallback((memory: MediaMemory) => {
    setCurrentMemory(memory)
    setSection('memories')
    setActiveMediaType('')
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(null, {}, null, null, 'default', memory)
  }, [loadFirstPage])

  const openDuplicateGroup = useCallback((group: MediaDuplicateGroup) => {
    const review: MediaCleanupReviewTarget = { kind: 'duplicate', group }
    setCurrentCleanupReview(review)
    setSection('cleanup')
    setActiveMediaType('')
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(null, {}, null, null, 'default', null, review)
  }, [loadFirstPage])

  const openBurstReview = useCallback((group: MediaBurstReview) => {
    const review: MediaCleanupReviewTarget = { kind: 'burst', group }
    setCurrentCleanupReview(review)
    setSection('cleanup')
    setActiveMediaType('')
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(null, {}, null, null, 'default', null, review)
  }, [loadFirstPage])

  const openAlbum = useCallback((album: MediaAlbum) => {
    setSection('albums')
    setActiveMediaType('')
    if (album.kind === 'smart') {
      setDraftFilters(mediaGalleryDraftFromQuery(album.query))
      setQuery({})
      void loadFirstPage(album, {})
      return
    }
    void loadFirstPage(album, query)
  }, [loadFirstPage, query])

  const openPlace = useCallback((place: MediaPlaceFacet) => {
    placesExpandedRef.current = true
    setSection('places')
    setActiveMediaType('')
    const nextDraft: MediaGalleryFilterDraft = {
      ...draftFilters,
      location: 'with',
      place: place.id,
    }
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(null, nextQuery)
  }, [draftFilters, loadFirstPage])

  const openPet = useCallback((pet: MediaPetFacet) => {
    setCurrentPet(pet)
    setSection('people')
    setActiveMediaType('')
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(
      null,
      {},
      null,
      null,
      'default',
      null,
      null,
      pet,
    )
  }, [loadFirstPage])

  const openSuggestedPerson = useCallback((person: MediaSuggestedPerson) => {
    setSection('people')
    setActiveMediaType('')
    setQuery({})
    setDraftFilters(emptyMediaGalleryFilterDraft)
    void loadFirstPage(null, {}, person, null)
  }, [loadFirstPage])

  const openPerson = useCallback((person: MediaPersonIdentity) => {
    setSection('people')
    setActiveMediaType('')
    const nextDraft = {
      ...emptyMediaGalleryFilterDraft,
      personIdentity: person.id,
    }
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setQuery(nextQuery)
    setDraftFilters(nextDraft)
    void loadFirstPage(null, nextQuery, null, person)
  }, [loadFirstPage])

  const openMediaType = useCallback((assetKind: string) => {
    setSection('media-types')
    setActiveMediaType(assetKind)
    const nextDraft = mediaGallerySectionDraft('media-types', assetKind)
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(null, nextQuery)
  }, [loadFirstPage])

  const leaveCollection = useCallback(() => {
    if (currentPet) {
      setCurrentPet(null)
      void loadFirstPage(null, {})
      return
    }
    if (currentCleanupReview) {
      void loadCleanup()
      return
    }
    if (currentMemory) {
      void loadMemories()
      return
    }
    if (section === 'media-types' && activeMediaType) {
      setActiveMediaType('')
    }
    const nextDraft = mediaGallerySectionDraft(section)
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(null, nextQuery)
  }, [
    activeMediaType,
    currentCleanupReview,
    currentMemory,
    currentPet,
    loadCleanup,
    loadFirstPage,
    loadMemories,
    section,
  ])

  const reviewSuggestedPerson = useCallback(async (
    suggestion: MediaSuggestedPerson,
    state: 'pending' | 'dismissed',
  ) => {
    if (!source.reviewSuggestedPerson) {
      throw new Error('当前客户端不支持人物建议审核')
    }
    setError('')
    try {
      const review = await source.reviewSuggestedPerson(suggestion.id, state)
      setSuggestedPeople((current) => current.map((item) => (
        item.id === suggestion.id
          ? {
              ...item,
              review_state: review.review_state || undefined,
              target_person_id: review.target_person_id,
            }
          : item
      )))
      return review
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [onError, source])

  const addSuggestedPersonToPerson = useCallback(async (
    suggestion: MediaSuggestedPerson,
    person: MediaPersonIdentity,
  ) => {
    if (!source.addSuggestedPersonToPerson) {
      throw new Error('当前客户端不支持将人物建议加入已有人物')
    }
    setError('')
    try {
      const updated = await source.addSuggestedPersonToPerson(
        suggestion.id,
        person.id,
        person.revision,
      )
      replacePerson(updated)
      setSuggestedPeople((current) => (
        current.filter((item) => item.id !== suggestion.id)
      ))
      return updated
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [onError, replacePerson, source])

  const adoptSuggestedPerson = useCallback(async (
    suggestion: MediaSuggestedPerson,
    name: string,
  ) => {
    if (!source.adoptSuggestedPerson) throw new Error('当前客户端不支持保存人物')
    setError('')
    try {
      const created = await source.adoptSuggestedPerson(suggestion.id, name)
      replacePerson(created)
      setSuggestedPeople((current) => current.filter((item) => item.id !== suggestion.id))
      await loadFirstPage(null, {}, null, created)
      return created
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [loadFirstPage, onError, replacePerson, source])

  const updatePerson = useCallback(async (
    person: MediaPersonIdentity,
    input: UpdateMediaPersonIdentityInput,
  ) => {
    if (!source.updatePerson) throw new Error('当前客户端不支持编辑人物')
    setError('')
    try {
      const updated = await source.updatePerson(person.id, person.revision, input)
      replacePerson(updated)
      return updated
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [onError, replacePerson, source])

  const mergePeople = useCallback(async (
    person: MediaPersonIdentity,
    sourceIDs: string[],
  ) => {
    if (!source.mergePeople) throw new Error('当前客户端不支持合并人物')
    setError('')
    try {
      const updated = await source.mergePeople(person.id, person.revision, sourceIDs)
      setPersonIdentities((current) => [
        updated,
        ...current.filter((item) => (
          item.id !== updated.id && !sourceIDs.includes(item.id)
        )),
      ])
      setCurrentPerson(updated)
      setAlbums(await source.listAlbums())
      const nextDraft = {
        ...draftFilters,
        personIdentity: updated.id,
      }
      const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
      setDraftFilters(nextDraft)
      setQuery(nextQuery)
      await loadFirstPage(null, nextQuery, null, updated)
      return updated
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [draftFilters, loadFirstPage, onError, source])

  const splitPerson = useCallback(async (
    person: MediaPersonIdentity,
    nodeIDs: number[],
    name: string,
  ) => {
    if (!source.splitPerson) throw new Error('当前客户端不支持拆分人物')
    setError('')
    try {
      const result = await source.splitPerson(person.id, person.revision, nodeIDs, name)
      setPersonIdentities((current) => [
        result.source,
        result.created,
        ...current.filter((item) => (
          item.id !== result.source.id && item.id !== result.created.id
        )),
      ])
      setCurrentPerson(result.source)
      await loadFirstPage(null, {}, null, result.source)
      return result
    } catch (personError) {
      setError(xDriveMediaGalleryErrorMessage(personError))
      onError?.(personError)
      throw personError
    }
  }, [loadFirstPage, onError, source])

  const patchLoadedItems = useCallback((
    nodeID: number,
    updater: (item: MediaItem) => MediaItem,
  ) => {
    setItems((current) => current.map((item) => (
      item.node.id === nodeID ? updater(item) : item
    )))
    virtualCollection.updateLoadedItems((item) => (
      item.node.id === nodeID ? updater(item) : item
    ))
  }, [virtualCollection.updateLoadedItems])

  const setFavorite = useCallback(async (
    item: MediaItem,
    favorite: boolean,
  ) => {
    if (!source.setFavorite) return
    setError('')
    try {
      await source.setFavorite(item.node.id, favorite)
      patchLoadedItems(item.node.id, (value) => ({ ...value, favorite }))
      if (
        query.favorite !== undefined ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.favorite !== undefined)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
          currentSuggestedPerson,
          currentPerson,
        )
      }
    } catch (favoriteError) {
      const message = xDriveMediaGalleryErrorMessage(favoriteError)
      setError(message)
      onError?.(favoriteError)
      throw favoriteError
    }
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, onError, patchLoadedItems, query, source])


  const setTags = useCallback(async (
    item: MediaItem,
    tags: string[],
  ) => {
    if (!source.setTags) return item.tags || []
    setError('')
    try {
      const normalized = await source.setTags(item.node.id, tags)
      patchLoadedItems(item.node.id, (value) => ({ ...value, tags: normalized }))
      if (
        query.tag ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.tag)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
          currentSuggestedPerson,
          currentPerson,
        )
      }
      return normalized
    } catch (tagError) {
      const message = xDriveMediaGalleryErrorMessage(tagError)
      setError(message)
      onError?.(tagError)
      throw tagError
    }
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, onError, patchLoadedItems, query, source])

  const setPeople = useCallback(async (
    item: MediaItem,
    people: string[],
  ) => {
    if (!source.setPeople) return item.people || []
    setError('')
    try {
      const normalized = await source.setPeople(item.node.id, people)
      patchLoadedItems(item.node.id, (value) => ({ ...value, people: normalized }))
      if (
        query.person ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.person)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
          currentSuggestedPerson,
          currentPerson,
        )
      }
      return normalized
    } catch (peopleError) {
      const message = xDriveMediaGalleryErrorMessage(peopleError)
      setError(message)
      onError?.(peopleError)
      throw peopleError
    }
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, onError, patchLoadedItems, query, source])

  const setDescription = useCallback(async (
    item: MediaItem,
    description: string,
  ) => {
    if (!source.setDescription) return item.description || ''
    setError('')
    try {
      const normalized = await source.setDescription(item.node.id, description)
      patchLoadedItems(item.node.id, (value) => ({ ...value, description: normalized }))
      if (
        query.search ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.search)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
          currentSuggestedPerson,
          currentPerson,
        )
      }
      return normalized
    } catch (descriptionError) {
      const message = xDriveMediaGalleryErrorMessage(descriptionError)
      setError(message)
      onError?.(descriptionError)
      throw descriptionError
    }
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, onError, patchLoadedItems, query, source])


  const saveEditRecipe = useCallback(async (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => {
    if (!source.saveEditRecipe) {
      throw new Error('当前客户端不支持媒体编辑')
    }
    setError('')
    try {
      const recipe = await source.saveEditRecipe(item.node.id, input)
      patchLoadedItems(item.node.id, (value) => ({
        ...value,
        edit_recipe: recipe.revision ? recipe : undefined,
      }))
      return recipe
    } catch (editError) {
      setError(xDriveMediaGalleryErrorMessage(editError))
      onError?.(editError)
      throw editError
    }
  }, [onError, patchLoadedItems, source])

  const resetEditRecipe = useCallback(async (
    item: MediaItem,
    revision: number,
  ) => {
    if (!source.resetEditRecipe) {
      throw new Error('当前客户端不支持重置媒体编辑')
    }
    setError('')
    try {
      const recipe = await source.resetEditRecipe(item.node.id, revision)
      patchLoadedItems(item.node.id, (value) => ({
        ...value,
        edit_recipe: recipe.revision ? recipe : undefined,
      }))
      return recipe
    } catch (editError) {
      setError(xDriveMediaGalleryErrorMessage(editError))
      onError?.(editError)
      throw editError
    }
  }, [onError, patchLoadedItems, source])


  const setFavoriteBatch = useCallback(async (
    selectedItems: MediaItem[],
    favorite: boolean,
  ) => {
    if (!source.setFavoriteBatch || selectedItems.length === 0) return
    setError('')
    try {
      const nodeIDs = selectedItems.map((item) => item.node.id)
      await source.setFavoriteBatch(nodeIDs, favorite)
      const selectedIDs = new Set(nodeIDs)
      setItems((current) => current.map((item) => (
        selectedIDs.has(item.node.id) ? { ...item, favorite } : item
      )))
      virtualCollection.updateLoadedItems((item) => (
        selectedIDs.has(item.node.id) ? { ...item, favorite } : item
      ))
      if (
        query.favorite !== undefined ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.favorite !== undefined)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
          currentSuggestedPerson,
          currentPerson,
        )
      }
    } catch (favoriteError) {
      setError(xDriveMediaGalleryErrorMessage(favoriteError))
      onError?.(favoriteError)
      throw favoriteError
    }
  }, [
    currentAlbum,
    currentPerson,
    currentSuggestedPerson,
    loadFirstPage,
    onError,
    query,
    source,
    virtualCollection.updateLoadedItems,
  ])

  const addTagsBatch = useCallback(async (
    selectedItems: MediaItem[],
    tags: string[],
  ) => {
    if (!source.addTagsBatch || selectedItems.length === 0) return
    setError('')
    try {
      await source.addTagsBatch(selectedItems.map((item) => item.node.id), tags)
      await loadFirstPage(
        currentAlbum,
        currentAlbum?.kind === 'smart' ? {} : query,
        currentSuggestedPerson,
        currentPerson,
      )
    } catch (tagError) {
      setError(xDriveMediaGalleryErrorMessage(tagError))
      onError?.(tagError)
      throw tagError
    }
  }, [
    currentAlbum,
    currentCleanupReview,
    currentPerson,
    currentSuggestedPerson,
    loadCleanup,
    loadFirstPage,
    onError,
    query,
    source,
  ])

  const addItemsToAlbum = useCallback(async (
    album: MediaAlbum,
    selectedItems: MediaItem[],
  ) => {
    if (!source.addToAlbum || !album.revision || selectedItems.length === 0) return
    setError('')
    try {
      const updated = await source.addToAlbum(
        album.id,
        album.revision,
        selectedItems.map((item) => item.node.id),
      )
      replaceAlbum(updated)
    } catch (albumError) {
      setError(xDriveMediaGalleryErrorMessage(albumError))
      onError?.(albumError)
      throw albumError
    }
  }, [onError, replaceAlbum, source])

  const deleteItems = useCallback(async (selectedItems: MediaItem[]) => {
    if (!source.deleteItems || selectedItems.length === 0) return
    setError('')
    try {
      await source.deleteItems(selectedItems)
      if (currentCleanupReview) {
        await loadCleanup()
        return
      }
      await loadFirstPage(
        currentAlbum,
        currentAlbum?.kind === 'smart' ? {} : query,
        currentSuggestedPerson,
        currentPerson,
      )
    } catch (deleteError) {
      setError(xDriveMediaGalleryErrorMessage(deleteError))
      onError?.(deleteError)
      throw deleteError
    }
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, onError, query, source])

  const downloadItems = useCallback(async (selectedItems: MediaItem[]) => {
    if (!source.downloadItems || selectedItems.length === 0) return
    setError('')
    try {
      await source.downloadItems(selectedItems)
    } catch (downloadError) {
      setError(xDriveMediaGalleryErrorMessage(downloadError))
      onError?.(downloadError)
      throw downloadError
    }
  }, [onError, source])


  const restoreTrashItems = useCallback(async (selectedItems: MediaItem[]) => {
    if (!source.restoreTrashItems || selectedItems.length === 0) return
    setError('')
    try {
      await source.restoreTrashItems(selectedItems)
      await loadFirstPage(null, {}, null, null, 'trash')
    } catch (restoreError) {
      setError(xDriveMediaGalleryErrorMessage(restoreError))
      onError?.(restoreError)
      throw restoreError
    }
  }, [loadFirstPage, onError, source])

  const permanentlyDeleteTrashItems = useCallback(async (selectedItems: MediaItem[]) => {
    if (!source.permanentlyDeleteTrashItems || selectedItems.length === 0) return
    setError('')
    try {
      await source.permanentlyDeleteTrashItems(selectedItems)
      await loadFirstPage(null, {}, null, null, 'trash')
    } catch (deleteError) {
      setError(xDriveMediaGalleryErrorMessage(deleteError))
      onError?.(deleteError)
      throw deleteError
    }
  }, [loadFirstPage, onError, source])

  useEffect(() => {
    const nextSection = initialSection ?? 'library'
    if (routeSectionAppliedRef.current === nextSection) return
    routeSectionAppliedRef.current = nextSection
    if (nextSection === 'library') void loadFirstPage(null, {})
    else selectSection(nextSection)
  }, [initialSection, loadFirstPage, selectSection])

  useEffect(() => () => {
    requestID.current += 1
  }, [])

  return (
    <XDriveWorkspaceSurface presentation="page" title="图库">
      <XDriveMediaGallery
        items={items}
        virtualCollection={galleryVirtualCollection}
        collectionKey={mediaGalleryCollectionKey(collectionTarget)}
        albums={albums}
        places={places}
        memories={memories}
        duplicateGroups={duplicateGroups}
        burstReviews={burstReviews}
        pets={pets}
        suggestedPeople={suggestedPeople}
        people={people}
        activePlaceID={query.place}
        currentAlbum={currentAlbum}
        currentSuggestedPerson={currentSuggestedPerson}
        currentPerson={currentPerson}
        currentPet={currentPet}
        currentMemory={currentMemory}
        currentCleanupReview={currentCleanupReview}
        loading={loading}
        timelineGroupSets={timelineGroupSets}
        error={error}
        section={section}
        activeMediaType={activeMediaType}
        searchActive={Boolean(query.search?.trim())}
        filters={(
          <XDriveMediaGalleryFilterToolbar
            draft={draftFilters}
            loading={loading}
            applyLabel={currentAlbum?.kind === 'smart' ? '保存规则' : '应用'}
            clearLabel={currentAlbum?.kind === 'smart' ? '还原规则' : '清除'}
            placeLabel={places.find((place) => place.id === draftFilters.place)?.name}
            personIdentityLabel={
              currentPerson?.name ||
              people.find((person) => person.id === draftFilters.personIdentity)?.name ||
              (draftFilters.personIdentity ? '未命名人物' : undefined)
            }
            personIdentityLocked={Boolean(currentPerson)}
            lockedAssetKind={
              section === 'media-types' &&
              Boolean(activeMediaType) &&
              activeMediaType !== 'gif' &&
              activeMediaType !== 'panorama'
            }
            lockedFavorite={section === 'favorites'}
            onChange={setDraftFilters}
            onApply={applyFilters}
            onClear={clearFilters}
            onSaveSmart={
              !currentAlbum && !currentSuggestedPerson && source.createSmartAlbum
                ? () => {
                    setSmartAlbumName('')
                    setSmartDialogError('')
                    setSmartDialogOpen(true)
                  }
                : undefined
            }
          />
        )}
        loadThumbnail={source.loadThumbnail}
        loadLivePhotoMotion={source.loadLivePhotoMotion}
        loadPreviewURL={source.loadPreviewURL}
        onSetFavorite={source.setFavorite ? setFavorite : undefined}
        onSetFavoriteBatch={source.setFavoriteBatch ? setFavoriteBatch : undefined}
        onAddTagsBatch={source.addTagsBatch ? addTagsBatch : undefined}
        onAddItemsToAlbum={source.addToAlbum ? addItemsToAlbum : undefined}
        onDeleteItems={source.deleteItems ? deleteItems : undefined}
        onDownloadItems={source.downloadItems ? downloadItems : undefined}
        onShareItem={shareDialog ? setShareItem : undefined}
        onOpenViewer={onOpenViewer ? (item, activeIndex) => {
          const target = collectionTargetRef.current
          if (!target) return
          const { requestID: _requestID, ...serializableTarget } = target
          onOpenViewer(item, {
            target: serializableTarget,
            activeIndex,
            totalCount: galleryVirtualCollection.itemCount,
          })
        } : undefined}
        onRestoreTrashItems={source.restoreTrashItems ? restoreTrashItems : undefined}
        onPermanentlyDeleteTrashItems={
          source.permanentlyDeleteTrashItems ? permanentlyDeleteTrashItems : undefined
        }
        onSetTags={source.setTags ? setTags : undefined}
        onSetPeople={source.setPeople ? setPeople : undefined}
        onSetDescription={source.setDescription ? setDescription : undefined}
        onSaveEditRecipe={source.saveEditRecipe ? saveEditRecipe : undefined}
        onResetEditRecipe={source.resetEditRecipe ? resetEditRecipe : undefined}
        onCreateCreativeGeneration={
          source.createCreativeGeneration
            ? (item, input) => source.createCreativeGeneration!(item.node.id, input)
            : undefined
        }
        onGetCreativeGeneration={source.getCreativeGeneration}
        onCancelCreativeGeneration={source.cancelCreativeGeneration}
        onCreateAlbum={source.createAlbum ? createAlbum : undefined}
        onRenameAlbum={
          source.renameAlbum || source.updateSmartAlbum
            ? renameAlbum
            : undefined
        }
        onDeleteAlbum={
          source.deleteAlbum || source.deleteSmartAlbum
            ? deleteAlbum
            : undefined
        }
        onAddToAlbum={source.addToAlbum ? addToAlbum : undefined}
        onRemoveFromAlbum={source.removeFromAlbum ? removeFromAlbum : undefined}
        onSectionChange={selectSection}
        onOpenMediaType={openMediaType}
        onOpenAlbum={openAlbum}
        onOpenPlace={openPlace}
        onOpenMemory={openMemory}
        onOpenDuplicateGroup={openDuplicateGroup}
        onOpenBurstReview={openBurstReview}
        onOpenPet={openPet}
        onOpenSuggestedPerson={openSuggestedPerson}
        onOpenPerson={openPerson}
        onReviewSuggestedPerson={
          source.reviewSuggestedPerson ? reviewSuggestedPerson : undefined
        }
        onAddSuggestedPersonToPerson={
          source.addSuggestedPersonToPerson
            ? addSuggestedPersonToPerson
            : undefined
        }
        onAdoptSuggestedPerson={
          source.adoptSuggestedPerson ? adoptSuggestedPerson : undefined
        }
        onRenamePerson={
          source.updatePerson
            ? (person, name) => updatePerson(person, { name })
            : undefined
        }
        onTogglePersonHidden={
          source.updatePerson
            ? (person) => updatePerson(person, { hidden: !person.hidden })
            : undefined
        }
        onSetPersonCover={
          source.updatePerson
            ? (person, item) => updatePerson(person, { cover_node_id: item.node.id })
            : undefined
        }
        onMergePeople={source.mergePeople ? mergePeople : undefined}
        onSplitPerson={source.splitPerson ? splitPerson : undefined}
        onBack={leaveCollection}
        onRefresh={() => {
          if (section === 'memories' && !currentMemory) {
            void loadMemories()
            return
          }
          if (section === 'cleanup' && !currentCleanupReview) {
            void loadCleanup()
            return
          }
          void loadFirstPage(
            currentAlbum,
            query,
            currentSuggestedPerson,
            currentPerson,
            section === 'trash' ? 'trash' : 'default',
            currentMemory,
            currentCleanupReview,
            currentPet,
          )
        }}
      />
      {shareDialog ? (
        <XDriveShareDialog
          adapter={shareDialog.adapter}
          node={shareItem?.node ?? null}
          onClose={() => setShareItem(null)}
          onError={reportError}
          expiryMode={shareDialog.expiryMode}
          listVariant={shareDialog.listVariant}
          showCloseAction={shareDialog.showCloseAction}
        />
      ) : null}
      <Dialog
        open={smartDialogOpen}
        onClose={() => !smartDialogBusy && setSmartDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="保存为智能相册"
          subtitle={
            currentPerson
              ? `保存人物「${currentPerson.name || '未命名人物'}」和当前筛选条件；内容会随图库变化自动更新。`
              : '保存当前筛选条件；内容会随图库变化自动更新。'
          }
          onClose={() => !smartDialogBusy && setSmartDialogOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="智能相册名称"
              value={smartAlbumName}
              onChange={(event) => {
                setSmartAlbumName(event.target.value)
                setSmartDialogError('')
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !smartAlbumName.trim() || smartDialogBusy) return
                event.preventDefault()
                setSmartDialogBusy(true)
                void createSmartAlbum(smartAlbumName.trim())
                  .then(() => setSmartDialogOpen(false))
                  .catch((createError) => setSmartDialogError(xDriveMediaGalleryErrorMessage(createError)))
                  .finally(() => setSmartDialogBusy(false))
              }}
            />
            {smartDialogError ? (
              <XDriveStatusAlert tone="bad">{smartDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setSmartDialogOpen(false)} disabled={smartDialogBusy}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!smartAlbumName.trim() || smartDialogBusy}
            onClick={() => {
              setSmartDialogBusy(true)
              setSmartDialogError('')
              void createSmartAlbum(smartAlbumName.trim())
                .then(() => setSmartDialogOpen(false))
                .catch((createError) => setSmartDialogError(xDriveMediaGalleryErrorMessage(createError)))
                .finally(() => setSmartDialogBusy(false))
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </XDriveWorkspaceSurface>
  )
}

export type XDriveMediaGalleryVirtualCollection = {
  itemCount: number
  loadedItems: ReadonlyMap<number, MediaItem>
  itemAt: (index: number) => MediaItem | undefined
  onRangeChange: (startIndex: number, endIndex: number) => void | Promise<void>
}

export interface XDriveMediaGalleryProps {
  items: MediaItem[]
  virtualCollection?: XDriveMediaGalleryVirtualCollection
  collectionKey?: string
  albums?: MediaAlbum[]
  places?: MediaPlaceFacet[]
  memories?: MediaMemory[]
  duplicateGroups?: MediaDuplicateGroupList | null
  burstReviews?: MediaBurstReviewList | null
  pets?: MediaPetFacet[]
  suggestedPeople?: MediaSuggestedPerson[]
  people?: MediaPersonIdentity[]
  activePlaceID?: string
  currentAlbum?: MediaAlbum | null
  currentSuggestedPerson?: MediaSuggestedPerson | null
  currentPerson?: MediaPersonIdentity | null
  currentPet?: MediaPetFacet | null
  currentMemory?: MediaMemory | null
  currentCleanupReview?: MediaCleanupReviewTarget | null
  loading?: boolean
  timelineGroupSets?: MediaTimelineGroupSets
  error?: string
  section?: MediaGallerySection
  activeMediaType?: string
  searchActive?: boolean
  filters?: ReactNode
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetFavoriteBatch?: (items: MediaItem[], favorite: boolean) => Promise<void>
  onAddTagsBatch?: (items: MediaItem[], tags: string[]) => Promise<void>
  onAddItemsToAlbum?: (album: MediaAlbum, items: MediaItem[]) => Promise<void>
  onDeleteItems?: (items: MediaItem[]) => Promise<void>
  onDownloadItems?: (items: MediaItem[]) => Promise<void>
  onShareItem?: (item: MediaItem) => void
  onOpenViewer?: (item: MediaItem, logicalIndex: number) => void
  onRestoreTrashItems?: (items: MediaItem[]) => Promise<void>
  onPermanentlyDeleteTrashItems?: (items: MediaItem[]) => Promise<void>
  onSetTags?: (item: MediaItem, tags: string[]) => Promise<string[]>
  onSetPeople?: (item: MediaItem, people: string[]) => Promise<string[]>
  onSetDescription?: (item: MediaItem, description: string) => Promise<string>
  onSaveEditRecipe?: (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => Promise<MediaEditRecipe>
  onResetEditRecipe?: (
    item: MediaItem,
    revision: number,
  ) => Promise<MediaEditRecipe>
  onCreateCreativeGeneration?: (
    item: MediaItem,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  onGetCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCancelCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCreateAlbum?: (name: string) => Promise<MediaAlbum>
  onRenameAlbum?: (album: MediaAlbum, name: string) => Promise<MediaAlbum>
  onDeleteAlbum?: (album: MediaAlbum) => Promise<void>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onSectionChange?: (section: MediaGallerySection) => void
  onOpenMediaType?: (assetKind: string) => void
  onOpenAlbum?: (album: MediaAlbum) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenMemory?: (memory: MediaMemory) => void
  onOpenDuplicateGroup?: (group: MediaDuplicateGroup) => void
  onOpenBurstReview?: (group: MediaBurstReview) => void
  onOpenPet?: (pet: MediaPetFacet) => void
  onOpenSuggestedPerson?: (person: MediaSuggestedPerson) => void
  onOpenPerson?: (person: MediaPersonIdentity) => void
  onReviewSuggestedPerson?: (
    suggestion: MediaSuggestedPerson,
    state: 'pending' | 'dismissed',
  ) => Promise<MediaPersonSuggestionReview>
  onAddSuggestedPersonToPerson?: (
    suggestion: MediaSuggestedPerson,
    person: MediaPersonIdentity,
  ) => Promise<MediaPersonIdentity>
  onAdoptSuggestedPerson?: (
    suggestion: MediaSuggestedPerson,
    name: string,
  ) => Promise<MediaPersonIdentity>
  onRenamePerson?: (
    person: MediaPersonIdentity,
    name: string,
  ) => Promise<MediaPersonIdentity>
  onTogglePersonHidden?: (
    person: MediaPersonIdentity,
  ) => Promise<MediaPersonIdentity>
  onSetPersonCover?: (
    person: MediaPersonIdentity,
    item: MediaItem,
  ) => Promise<MediaPersonIdentity>
  onMergePeople?: (
    person: MediaPersonIdentity,
    sourceIDs: string[],
  ) => Promise<MediaPersonIdentity>
  onSplitPerson?: (
    person: MediaPersonIdentity,
    nodeIDs: number[],
    name: string,
  ) => Promise<MediaPersonSplit>
  onBack?: () => void
  onRefresh?: () => void
}

function mediaAssetChipLabel(item: MediaItem) {
  if (item.metadata.mime_type?.toLowerCase() === 'image/gif') return 'GIF'
  if (item.metadata.exif?.is_panorama === true) return '全景'
  if (item.live_photo || item.asset_kind === 'live_photo') return '实况'
  switch (item.asset_kind) {
    case 'raw_pair':
      return 'RAW'
    case 'burst':
      return '连拍'
    case 'sidecar':
      return '组合'
    default:
      if (item.metadata.media_kind === 'video') {
        return item.metadata.duration_ms
          ? xDriveMediaFormatDuration(item.metadata.duration_ms)
          : '视频'
      }
      return '图片'
  }
}

type MediaGalleryTimeScale = 'year' | 'month' | 'day' | 'all'

const mediaGalleryMediaTypes = [
  { value: 'image', label: '图片', description: '普通照片与静态图像' },
  { value: 'video', label: '视频', description: '所有视频媒体' },
  { value: 'live_photo', label: '实况照片', description: '照片与动态视频组成的实况资产' },
  { value: 'raw_pair', label: 'RAW 组合', description: 'RAW 与渲染照片组成的逻辑资产' },
  { value: 'burst', label: '连拍', description: '由本地证据识别的连拍组' },
  { value: 'gif', label: 'GIF / 动图', description: '按实际 image/gif MIME 分类' },
  { value: 'panorama', label: '全景', description: '仅识别带 GPano/XMP 明确信号的全景照片' },
  { value: 'sidecar', label: '编辑组合', description: '带确定性 sidecar 关系的媒体' },
] as const

function mediaGalleryMediaTypeLabel(value?: string) {
  return mediaGalleryMediaTypes.find((item) => item.value === value)?.label
}

type MediaTimelineGroup = {
  key: string
  label: string
  items: MediaItem[]
  startIndex: number
}

function mediaTimelineDate(item: MediaItem) {
  if (!item.metadata.captured_at) return null
  const captured = new Date(item.metadata.captured_at)
  return Number.isNaN(captured.getTime()) ? null : captured
}

function mediaTimelineGroups(
  items: MediaItem[],
  scale: Exclude<MediaGalleryTimeScale, 'all'>,
): MediaTimelineGroup[] {
  const groups = new Map<string, MediaTimelineGroup>()
  const unknown: MediaItem[] = []
  for (const item of items) {
    const date = mediaTimelineDate(item)
    if (!date) {
      unknown.push(item)
      continue
    }
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const key = scale === 'year'
      ? year
      : scale === 'month'
        ? `${year}-${month}`
        : `${year}-${month}-${day}`
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      continue
    }
    const formatOptions: Intl.DateTimeFormatOptions = scale === 'year'
      ? { year: 'numeric' }
      : scale === 'month'
        ? { year: 'numeric', month: 'long' }
        : { year: 'numeric', month: 'long', day: 'numeric' }
    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat('zh-CN', formatOptions).format(date),
      items: [item],
      startIndex: 0,
    })
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key))
  let startIndex = 0
  for (const group of ordered) {
    group.startIndex = startIndex
    startIndex += group.items.length
  }
  if (unknown.length > 0) {
    ordered.push({ key: 'unknown', label: '日期未知', items: unknown, startIndex })
  }
  return ordered
}

function keyboardActivate(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

type MediaSelectionModifiers = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

type MediaTileProps = {
  item: MediaItem
  logicalIndex: number
  selectionMode: boolean
  selectedForAction: boolean
  recommendedForCleanup?: boolean
  onSelect: (
    item: MediaItem,
    index: number,
    modifiers: MediaSelectionModifiers,
  ) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler?: XDriveMediaThumbnailScheduler
  thumbnailPriority?: XDriveMediaThumbnailPriority
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
}

function MediaTile({
  item,
  logicalIndex,
  selectionMode,
  selectedForAction,
  recommendedForCleanup = false,
  onSelect,
  loadThumbnail,
  thumbnailScheduler,
  thumbnailPriority = 1,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  onOpen,
  onPreview,
  onToggleFavorite,
}: MediaTileProps) {
  const video = item.metadata.media_kind === 'video'
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  const clickTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
  }, [])

  const openDetails = () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      onOpen(item)
    }, 350)
  }

  const openPreview = () => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    onPreview(item)
  }

  const effectiveThumbnailLoader = useCallback(
    (nodeID: number) => thumbnailScheduler
      ? thumbnailScheduler.load(nodeID, thumbnailPriority)
      : loadThumbnail(nodeID),
    [loadThumbnail, thumbnailPriority, thumbnailScheduler],
  )

  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
          if (clickTimerRef.current !== null) {
            window.clearTimeout(clickTimerRef.current)
            clickTimerRef.current = null
          }
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        openDetails()
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        if (!selectionMode) openPreview()
      }}
      onKeyDown={(event) => {
        if (selectionMode && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault()
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        keyboardActivate(event, () => onOpen(item))
      }}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        bgcolor: 'action.hover',
        borderColor: selectedForAction ? 'primary.main' : 'divider',
        boxShadow: selectedForAction ? 2 : 0,
        '&:hover .media-name': { opacity: 1 },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      {video && !livePhoto && loadPreviewURL ? (
        <XDriveMediaAsyncVideoPoster
          nodeID={item.node.id}
          alt={item.node.name}
          loadPreviewURL={loadPreviewURL}
          rotationDegrees={item.metadata.rotation_degrees}
          sourceWidth={item.metadata.width}
          sourceHeight={item.metadata.height}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
        />
      ) : (
        <XDriveMediaAsyncThumbnail
          nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
          alt={item.node.name}
          loadThumbnail={effectiveThumbnailLoader}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
          revokeOnDispose={!thumbnailScheduler}
        />
      )}
      {recommendedForCleanup ? (
        <Chip
          size="small"
          label="建议保留"
          data-xdrive-media-cleanup-recommended
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 4,
            bgcolor: 'background.paper',
            boxShadow: 1,
            fontWeight: 700,
          }}
        />
      ) : null}
      {(selectionMode || selectedForAction) ? (
        <Checkbox
          size="small"
          checked={selectedForAction}
          aria-label={selectedForAction ? '取消选择' : '选择'}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(item, logicalIndex, {
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
            })
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          sx={{
            position: 'absolute',
            top: 4,
            left: 4,
            zIndex: 3,
            p: 0.5,
            bgcolor: 'rgba(0,0,0,.58)',
            color: '#fff',
            borderRadius: 1,
            '&.Mui-checked': { color: 'primary.light' },
            '&:hover': { bgcolor: 'rgba(0,0,0,.72)' },
          }}
        />
      ) : null}
      {onSetFavorite ? (
        <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            size="small"
            aria-label={item.favorite ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(item)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            sx={{
              position: 'absolute',
              top: 8,
              left: selectionMode || selectedForAction ? 42 : 8,
              bgcolor: 'rgba(0,0,0,.66)',
              color: item.favorite ? 'warning.main' : '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,.78)' },
            }}
          >
            {item.favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      <Chip
        icon={livePhoto ? <XDriveLivePhotoGlyph size={20} /> : video ? <MovieIcon /> : <ImageIcon />}
        label={mediaAssetChipLabel(item)}
        size="small"
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          bgcolor: 'rgba(0,0,0,.66)',
          color: '#fff',
          '& .MuiChip-icon': { color: '#fff' },
        }}
      />
      {item.edit_recipe?.source_current && item.edit_recipe.revision > 0 ? (
        <Chip
          label="已编辑"
          size="small"
          data-xdrive-media-edited
          sx={{
            position: 'absolute',
            top: 40,
            right: 8,
            bgcolor: 'rgba(0,0,0,.66)',
            color: '#fff',
          }}
        />
      ) : null}
      {onSetCover ? (
        <Button
          size="small"
          variant="contained"
          onClick={(event) => {
            event.stopPropagation()
            onSetCover(item)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          sx={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            minWidth: 0,
            px: 1,
            py: 0.25,
            fontSize: 12,
            zIndex: 2,
            bgcolor: 'rgba(0,0,0,.68)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.82)' },
          }}
        >
          设封面
        </Button>
      ) : null}
      <Box
        className="media-name"
        sx={{
          position: 'absolute',
          inset: 'auto 0 0',
          px: 1,
          pt: 2.5,
          pb: 0.75,
          opacity: { xs: 1, md: 0 },
          transition: 'opacity 120ms ease',
          background: 'linear-gradient(transparent, rgba(0,0,0,.72))',
        }}
      >
        <Typography variant="caption" color="#fff" noWrap display="block">
          {item.node.name}
        </Typography>
      </Box>
    </Paper>
  )
}

function MediaTileGrid({
  items,
  minTileWidth,
  loadThumbnail,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedNodeIDs,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
  recommendedNodeID,
  indexOffset = 0,
}: {
  items: MediaItem[]
  minTileWidth: number
  selectionMode: boolean
  selectedNodeIDs: ReadonlySet<number>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  indexOffset?: number
  loadThumbnail: MediaThumbnailLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
  recommendedNodeID?: number
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
        gap: 1,
      }}
    >
      {items.map((item, index) => (
        <MediaTile
          key={item.node.id}
          item={item}
          logicalIndex={indexOffset + index}
          selectionMode={selectionMode}
          selectedForAction={selectedNodeIDs.has(item.node.id)}
          recommendedForCleanup={item.node.id === recommendedNodeID}
          onSelect={onSelect}
          loadThumbnail={loadThumbnail}
          loadPreviewURL={loadPreviewURL}
          onSetFavorite={onSetFavorite}
          onSetCover={onSetCover}
          onOpen={onOpen}
          onPreview={onPreview}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </Box>
  )
}

function mediaGalleryScrollParent(element: HTMLElement) {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

function MediaVirtualTileGrid({
  collection,
  minTileWidth,
  loadThumbnail,
  thumbnailScheduler,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedNodeIDs,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
  recommendedNodeID,
}: {
  collection: XDriveMediaGalleryVirtualCollection
  minTileWidth: number
  selectionMode: boolean
  selectedNodeIDs: ReadonlySet<number>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem, index: number) => void
  onToggleFavorite: (item: MediaItem) => void
  recommendedNodeID?: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [layout, setLayout] = useState(() => ({
    metrics: xDriveMediaGalleryGridMetrics({
      width: 0,
      itemCount: collection.itemCount,
      minColumnWidth: minTileWidth,
    }),
    window: { start: 0, end: 0, startRow: 0, endRow: 0 },
    visibleWindow: { start: 0, end: 0, startRow: 0, endRow: 0 },
  }))

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scrollParent = mediaGalleryScrollParent(host)
    const scrollTarget: HTMLElement | Window = scrollParent ?? window
    let disposed = false

    const update = () => {
      if (disposed) return
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        if (disposed || !hostRef.current) return
        const currentHost = hostRef.current
        const metrics = xDriveMediaGalleryGridMetrics({
          width: currentHost.clientWidth,
          itemCount: collection.itemCount,
          minColumnWidth: minTileWidth,
        })
        const hostRect = currentHost.getBoundingClientRect()
        const viewportTop = scrollParent
          ? scrollParent.getBoundingClientRect().top
          : 0
        const viewportBottom = scrollParent
          ? scrollParent.getBoundingClientRect().bottom
          : window.innerHeight
        const visibleTop = Math.max(0, viewportTop - hostRect.top)
        const visibleBottom = Math.min(
          metrics.totalHeight,
          Math.max(visibleTop, viewportBottom - hostRect.top),
        )
        const visibleWindow = xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount,
          columns: metrics.columns,
          rowStep: metrics.rowStep,
          visibleTop,
          visibleBottom,
          overscanRows: 0,
        })
        const nextWindow = xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount,
          columns: metrics.columns,
          rowStep: metrics.rowStep,
          visibleTop,
          visibleBottom,
        })
        setLayout((current) => (
          current.metrics.columns === metrics.columns &&
          Math.abs(current.metrics.totalHeight - metrics.totalHeight) < 0.5 &&
          current.window.start === nextWindow.start &&
          current.window.end === nextWindow.end &&
          current.visibleWindow.start === visibleWindow.start &&
          current.visibleWindow.end === visibleWindow.end
            ? current
            : { metrics, window: nextWindow, visibleWindow }
        ))
        if (nextWindow.end > nextWindow.start) {
          void collection.onRangeChange(nextWindow.start, nextWindow.end - 1)
        }
      })
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(host)
    scrollTarget.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      scrollTarget.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [collection.itemCount, collection.onRangeChange, minTileWidth])

  useEffect(() => {
    const retainedNodeIDs: number[] = []
    for (let index = layout.window.start; index < layout.window.end; index += 1) {
      const item = collection.itemAt(index)
      if (item?.metadata.has_thumbnail) retainedNodeIDs.push(item.node.id)
    }
    thumbnailScheduler.setRetention(retainedNodeIDs)
  }, [
    collection.itemAt,
    collection.loadedItems,
    layout.window.end,
    layout.window.start,
    thumbnailScheduler,
  ])

  useEffect(() => () => {
    thumbnailScheduler.setRetention([])
  }, [thumbnailScheduler])

  const slots = []
  for (let index = layout.window.start; index < layout.window.end; index += 1) {
    const item = collection.itemAt(index)
    const thumbnailPriority: XDriveMediaThumbnailPriority = (
      index >= layout.visibleWindow.start &&
      index < layout.visibleWindow.end
    ) ? 0 : 1
    slots.push(
      item ? (
        <MediaTile
          key={item.node.id}
          item={item}
          logicalIndex={index}
          selectionMode={selectionMode}
          selectedForAction={selectedNodeIDs.has(item.node.id)}
          recommendedForCleanup={item.node.id === recommendedNodeID}
          onSelect={onSelect}
          loadThumbnail={loadThumbnail}
          thumbnailScheduler={thumbnailScheduler}
          thumbnailPriority={thumbnailPriority}
          loadPreviewURL={loadPreviewURL}
          onSetFavorite={onSetFavorite}
          onSetCover={onSetCover}
          onOpen={onOpen}
          onPreview={(value) => onPreview(value, index)}
          onToggleFavorite={onToggleFavorite}
        />
      ) : (
        <Paper
          key={`media-placeholder-${index}`}
          variant="outlined"
          aria-hidden
          data-xdrive-media-gallery-placeholder
          sx={{
            aspectRatio: '1 / 1',
            bgcolor: 'action.hover',
            opacity: 0.55,
          }}
        />
      ),
    )
  }

  return (
    <Box
      ref={hostRef}
      data-xdrive-media-gallery-virtual-grid
      sx={{
        position: 'relative',
        height: layout.metrics.totalHeight,
        minHeight: collection.itemCount > 0 ? 150 : 0,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: layout.window.startRow * layout.metrics.rowStep,
          insetInline: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${layout.metrics.columns}, minmax(0, 1fr))`,
          gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
        }}
      >
        {slots}
      </Box>
    </Box>
  )
}


function sameMediaTimelineWindow(
  left: ReturnType<typeof xDriveMediaGalleryTimelineWindow>,
  right: ReturnType<typeof xDriveMediaGalleryTimelineWindow>,
) {
  if (
    left.startIndex !== right.startIndex ||
    left.endIndex !== right.endIndex ||
    left.segments.length !== right.segments.length
  ) return false
  return left.segments.every((segment, index) => {
    const other = right.segments[index]
    return Boolean(other) &&
      segment.groupIndex === other.groupIndex &&
      segment.startRow === other.startRow &&
      segment.endRow === other.endRow &&
      segment.startIndex === other.startIndex &&
      segment.endIndex === other.endIndex
  })
}

function MediaVirtualTimeline({
  groups,
  collection,
  minTileWidth,
  loadThumbnail,
  thumbnailScheduler,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedNodeIDs,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
}: {
  groups: MediaTimelineGroupIndex[]
  collection: XDriveMediaGalleryVirtualCollection
  minTileWidth: number
  selectionMode: boolean
  selectedNodeIDs: ReadonlySet<number>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem, index: number) => void
  onToggleFavorite: (item: MediaItem) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [state, setState] = useState(() => {
    const layout = xDriveMediaGalleryTimelineLayout({
      width: 0,
      groups,
      minColumnWidth: minTileWidth,
    })
    const window = xDriveMediaGalleryTimelineWindow({
      layout,
      visibleTop: 0,
      visibleBottom: 0,
    })
    return { layout, window, visibleWindow: window }
  })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scrollParent = mediaGalleryScrollParent(host)
    const scrollTarget: HTMLElement | Window = scrollParent ?? window
    let disposed = false

    const update = () => {
      if (disposed) return
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        if (disposed || !hostRef.current) return
        const currentHost = hostRef.current
        const layout = xDriveMediaGalleryTimelineLayout({
          width: currentHost.clientWidth,
          groups,
          minColumnWidth: minTileWidth,
        })
        const hostRect = currentHost.getBoundingClientRect()
        const viewportTop = scrollParent
          ? scrollParent.getBoundingClientRect().top
          : 0
        const viewportBottom = scrollParent
          ? scrollParent.getBoundingClientRect().bottom
          : window.innerHeight
        const visibleTop = Math.max(0, viewportTop - hostRect.top)
        const visibleBottom = Math.min(
          layout.totalHeight,
          Math.max(visibleTop, viewportBottom - hostRect.top),
        )
        const visibleWindow = xDriveMediaGalleryTimelineWindow({
          layout,
          visibleTop,
          visibleBottom,
          overscanRows: 0,
        })
        const nextWindow = xDriveMediaGalleryTimelineWindow({
          layout,
          visibleTop,
          visibleBottom,
        })
        setState((current) => (
          current.layout.columns === layout.columns &&
          Math.abs(current.layout.totalHeight - layout.totalHeight) < 0.5 &&
          sameMediaTimelineWindow(current.window, nextWindow) &&
          sameMediaTimelineWindow(current.visibleWindow, visibleWindow)
            ? current
            : { layout, window: nextWindow, visibleWindow }
        ))
        if (nextWindow.endIndex > nextWindow.startIndex) {
          void collection.onRangeChange(
            nextWindow.startIndex,
            nextWindow.endIndex - 1,
          )
        }
      })
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(host)
    scrollTarget.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      scrollTarget.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [collection.onRangeChange, groups, minTileWidth])

  useEffect(() => {
    const retainedNodeIDs: number[] = []
    for (const segment of state.window.segments) {
      for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
        const item = collection.itemAt(index)
        if (item?.metadata.has_thumbnail) retainedNodeIDs.push(item.node.id)
      }
    }
    thumbnailScheduler.setRetention(retainedNodeIDs)
  }, [
    collection.itemAt,
    collection.loadedItems,
    state.window,
    thumbnailScheduler,
  ])

  useEffect(() => () => {
    thumbnailScheduler.setRetention([])
  }, [thumbnailScheduler])

  return (
    <Box
      ref={hostRef}
      data-xdrive-media-gallery-virtual-timeline
      sx={{
        position: 'relative',
        height: state.layout.totalHeight,
        minHeight: collection.itemCount > 0 ? 150 : 0,
      }}
    >
      {state.window.segments.map((segment) => {
        const group = state.layout.groups[segment.groupIndex]
        if (!group) return null
        const slots = []
        for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
          const item = collection.itemAt(index)
          const thumbnailPriority: XDriveMediaThumbnailPriority =
            xDriveMediaGalleryTimelineIndexVisible(index, state.visibleWindow)
              ? 0
              : 1
          slots.push(
            item ? (
              <MediaTile
                key={item.node.id}
                item={item}
                logicalIndex={index}
                selectionMode={selectionMode}
                selectedForAction={selectedNodeIDs.has(item.node.id)}
                onSelect={onSelect}
                loadThumbnail={loadThumbnail}
                thumbnailScheduler={thumbnailScheduler}
                thumbnailPriority={thumbnailPriority}
                loadPreviewURL={loadPreviewURL}
                onSetFavorite={onSetFavorite}
                onSetCover={onSetCover}
                onOpen={onOpen}
                onPreview={(value) => onPreview(value, index)}
                onToggleFavorite={onToggleFavorite}
              />
            ) : (
              <Paper
                key={`media-timeline-placeholder-${index}`}
                variant="outlined"
                aria-hidden
                data-xdrive-media-gallery-timeline-placeholder
                sx={{
                  aspectRatio: '1 / 1',
                  bgcolor: 'action.hover',
                  opacity: 0.55,
                }}
              />
            ),
          )
        }

        return (
          <Box
            key={group.key}
            sx={{
              position: 'absolute',
              top: group.top,
              insetInline: 0,
              height: group.height,
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="baseline"
              sx={{
                height: group.headerHeight,
                mb: `${XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP}px`,
              }}
            >
              <Typography variant="subtitle1" fontWeight={700}>
                {group.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {group.itemCount.toLocaleString('zh-CN')} 项
              </Typography>
            </Stack>
            {segment.endIndex > segment.startIndex ? (
              <Box
                sx={{
                  position: 'absolute',
                  top:
                    group.headerHeight +
                    XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP +
                    segment.startRow * state.layout.rowStep,
                  insetInline: 0,
                  display: 'grid',
                  gridTemplateColumns:
                    `repeat(${state.layout.columns}, minmax(0, 1fr))`,
                  gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
                }}
              >
                {slots}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export function XDriveMediaGallery({
  items,
  virtualCollection,
  collectionKey = '',
  albums = [],
  places = [],
  memories = [],
  duplicateGroups = null,
  burstReviews = null,
  pets = [],
  suggestedPeople = [],
  people = [],
  activePlaceID,
  currentAlbum = null,
  currentSuggestedPerson = null,
  currentPerson = null,
  currentPet = null,
  currentMemory = null,
  currentCleanupReview = null,
  loading = false,
  timelineGroupSets = emptyMediaTimelineGroupSets(),
  error = '',
  section = 'library',
  activeMediaType = '',
  searchActive = false,
  filters,
  loadThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  onSetFavorite,
  onSetFavoriteBatch,
  onAddTagsBatch,
  onAddItemsToAlbum,
  onDeleteItems,
  onDownloadItems,
  onShareItem,
  onOpenViewer,
  onRestoreTrashItems,
  onPermanentlyDeleteTrashItems,
  onSetTags,
  onSetPeople,
  onSetDescription,
  onSaveEditRecipe,
  onResetEditRecipe,
  onCreateCreativeGeneration,
  onGetCreativeGeneration,
  onCancelCreativeGeneration,
  onCreateAlbum,
  onRenameAlbum,
  onDeleteAlbum,
  onAddToAlbum,
  onRemoveFromAlbum,
  onSectionChange,
  onOpenMediaType,
  onOpenAlbum,
  onOpenPlace,
  onOpenMemory,
  onOpenDuplicateGroup,
  onOpenBurstReview,
  onOpenPet,
  onOpenSuggestedPerson,
  onOpenPerson,
  onReviewSuggestedPerson,
  onAddSuggestedPersonToPerson,
  onAdoptSuggestedPerson,
  onRenamePerson,
  onTogglePersonHidden,
  onSetPersonCover,
  onMergePeople,
  onSplitPerson,
  onBack,
  onRefresh,
}: XDriveMediaGalleryProps) {
  const thumbnailScheduler = useMemo(
    () => new XDriveMediaThumbnailScheduler(loadThumbnail),
    [loadThumbnail],
  )
  useEffect(() => () => {
    thumbnailScheduler.dispose()
  }, [thumbnailScheduler])

  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)
  const [previewLogicalIndex, setPreviewLogicalIndex] = useState<number | null>(null)
  const [pendingPreviewIndex, setPendingPreviewIndex] = useState<number | null>(null)
  const [timeScale, setTimeScale] = useState<MediaGalleryTimeScale>('all')
  const [minTileWidth, setMinTileWidth] = useState(150)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const selectionBusyRef = useRef(false)
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null)
  const [selectedMediaItems, setSelectedMediaItems] = useState<Map<number, MediaItem>>(
    () => new Map(),
  )
  const [collageDialogItems, setCollageDialogItems] = useState<MediaItem[] | null>(null)
  const [movieDialogItems, setMovieDialogItems] = useState<MediaItem[] | null>(null)
  const [albumDialog, setAlbumDialog] = useState<{ mode: 'create' | 'rename'; album?: MediaAlbum } | null>(null)
  const [albumName, setAlbumName] = useState('')
  const [albumDialogBusy, setAlbumDialogBusy] = useState(false)
  const [albumDialogError, setAlbumDialogError] = useState('')
  const [deleteAlbumOpen, setDeleteAlbumOpen] = useState(false)

  const [showHiddenPeople, setShowHiddenPeople] = useState(false)
  const [showDismissedSuggestions, setShowDismissedSuggestions] = useState(false)
  const [suggestionReviewBusyID, setSuggestionReviewBusyID] =
    useState<string | null>(null)
  const [suggestionTargetDialog, setSuggestionTargetDialog] =
    useState<MediaSuggestedPerson | null>(null)
  const [personNameDialog, setPersonNameDialog] = useState<{
    mode: 'adopt' | 'rename'
    suggestion?: MediaSuggestedPerson
    person?: MediaPersonIdentity
  } | null>(null)
  const [personName, setPersonName] = useState('')
  const [personDialogBusy, setPersonDialogBusy] = useState(false)
  const [personDialogError, setPersonDialogError] = useState('')
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergePersonIDs, setMergePersonIDs] = useState<string[]>([])
  const [splitDialogOpen, setSplitDialogOpen] = useState(false)
  const [splitNodeIDs, setSplitNodeIDs] = useState<number[]>([])
  const [splitName, setSplitName] = useState('')

  const patchLocalMediaItem = useCallback((
    nodeID: number,
    updater: (item: MediaItem) => MediaItem,
  ) => {
    setSelected((current) => (
      current?.node.id === nodeID ? updater(current) : current
    ))
    setPreviewItem((current) => (
      current?.node.id === nodeID ? updater(current) : current
    ))
    setSelectedMediaItems((current) => {
      const selectedItem = current.get(nodeID)
      if (!selectedItem) return current
      const next = new Map(current)
      next.set(nodeID, updater(selectedItem))
      return next
    })
  }, [])

  const saveLocalEditRecipe = useCallback(async (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => {
    if (!onSaveEditRecipe) throw new Error('当前客户端不支持媒体编辑')
    const recipe = await onSaveEditRecipe(item, input)
    patchLocalMediaItem(item.node.id, (value) => ({
      ...value,
      edit_recipe: recipe.revision ? recipe : undefined,
    }))
    return recipe
  }, [onSaveEditRecipe, patchLocalMediaItem])

  const resetLocalEditRecipe = useCallback(async (
    item: MediaItem,
    revision: number,
  ) => {
    if (!onResetEditRecipe) throw new Error('当前客户端不支持重置媒体编辑')
    const recipe = await onResetEditRecipe(item, revision)
    patchLocalMediaItem(item.node.id, (value) => ({
      ...value,
      edit_recipe: recipe.revision ? recipe : undefined,
    }))
    return recipe
  }, [onResetEditRecipe, patchLocalMediaItem])

  const openAlbumDialog = (mode: 'create' | 'rename', album?: MediaAlbum) => {
    setAlbumDialog({ mode, album })
    setAlbumName(album?.name || '')
    setAlbumDialogError('')
  }

  const toggleFavorite = useCallback(async (item: MediaItem) => {
    if (!onSetFavorite) return
    const favorite = !item.favorite
    await onSetFavorite(item, favorite)
    setSelected((current) => (
      current?.node.id === item.node.id
        ? { ...current, favorite }
        : current
    ))
    setPreviewItem((current) => (
      current?.node.id === item.node.id
        ? { ...current, favorite }
        : current
    ))
  }, [onSetFavorite])

  const effectiveTimeScale: MediaGalleryTimeScale =
    searchActive || currentCleanupReview ? 'all' : timeScale
  const activeTimelineGroups = effectiveTimeScale === 'year'
    ? timelineGroupSets.year
    : effectiveTimeScale === 'month'
      ? timelineGroupSets.month
      : effectiveTimeScale === 'day'
        ? timelineGroupSets.day
        : []
  const denseTimelineGroups = useMemo(
    () => effectiveTimeScale === 'all'
      ? []
      : mediaTimelineGroups(items, effectiveTimeScale),
    [effectiveTimeScale, items],
  )
  const logicalItemCount = virtualCollection?.itemCount ?? items.length
  const openMediaItem = useCallback((item: MediaItem) => setSelected(item), [])
  const openMediaPreview = useCallback((item: MediaItem, index?: number) => {
    if (section === 'trash') return
    const activeIndex = index ?? items.findIndex((candidate) => candidate.node.id === item.node.id)
    if (onOpenViewer && activeIndex >= 0) {
      onOpenViewer(item, activeIndex)
      return
    }
    setPreviewItem(item)
    setPreviewLogicalIndex(index ?? null)
    setPendingPreviewIndex(null)
  }, [items, onOpenViewer, section])
  const previewIndex = previewLogicalIndex ?? (
    previewItem
      ? items.findIndex((item) => item.node.id === previewItem.node.id)
      : -1
  )

  const requestPreviewIndex = useCallback((index: number) => {
    if (index < 0 || index >= logicalItemCount) return
    const item = virtualCollection?.itemAt(index) ?? items[index]
    if (item) {
      setPreviewItem(item)
      setPreviewLogicalIndex(index)
      setPendingPreviewIndex(null)
      return
    }
    if (!virtualCollection) return
    setPendingPreviewIndex(index)
    void virtualCollection.onRangeChange(index, index)
  }, [items, logicalItemCount, virtualCollection])

  useEffect(() => {
    if (pendingPreviewIndex === null || !virtualCollection) return
    const item = virtualCollection.itemAt(pendingPreviewIndex)
    if (!item) return
    setPreviewItem(item)
    setPreviewLogicalIndex(pendingPreviewIndex)
    setPendingPreviewIndex(null)
  }, [pendingPreviewIndex, virtualCollection, virtualCollection?.loadedItems])
  useEffect(() => {
    if (previewIndex < 0 || !virtualCollection || logicalItemCount <= 0) return
    const start = Math.max(0, previewIndex - 6)
    const end = Math.min(logicalItemCount - 1, previewIndex + 6)
    void virtualCollection.onRangeChange(start, end)
  }, [logicalItemCount, previewIndex, virtualCollection?.onRangeChange])

  const previewFilmstripEntries = useMemo(() => {
    if (previewIndex < 0 || logicalItemCount <= 0) return []
    const start = Math.max(0, previewIndex - 5)
    const end = Math.min(logicalItemCount - 1, previewIndex + 5)
    const entries: Array<{ index: number; item: MediaItem }> = []
    for (let index = start; index <= end; index += 1) {
      const item = virtualCollection?.itemAt(index) ?? items[index]
      if (item) entries.push({ index, item })
    }
    return entries
  }, [
    items,
    logicalItemCount,
    previewIndex,
    virtualCollection?.loadedItems,
  ])

  const closeMediaPreview = useCallback(() => {
    setPreviewItem(null)
    setPreviewLogicalIndex(null)
    setPendingPreviewIndex(null)
  }, [])

  const openPreviewInfo = useCallback((item: MediaItem) => {
    closeMediaPreview()
    setSelected(item)
  }, [closeMediaPreview])

  const toggleMediaFavorite = useCallback((item: MediaItem) => {
    void toggleFavorite(item).catch(() => undefined)
  }, [toggleFavorite])

  const selectedMedia = useMemo(
    () => Array.from(selectedMediaItems.values()),
    [selectedMediaItems],
  )
  const selectedNodeIDs = useMemo(
    () => new Set(selectedMediaItems.keys()),
    [selectedMediaItems],
  )
  const collageSelectionEligible =
    selectedMedia.length >= 2 &&
    selectedMedia.length <= 9 &&
    selectedMedia.every(xDriveMediaItemSupportsCollage)
  const movieSelectionEligible =
    selectedMedia.length >= 2 &&
    selectedMedia.length <= 30 &&
    selectedMedia.every(xDriveMediaItemSupportsAutoMovie)
  const allSelectedFavorite = selectedMedia.length > 0 &&
    selectedMedia.every((item) => Boolean(item.favorite))
  const selectedTrashRoots = useMemo(() => {
    const roots = new Map<number, MediaItem['node']>()
    for (const item of selectedMedia) {
      const root = item.trash_root ?? item.node
      roots.set(root.id, root)
    }
    return Array.from(roots.values())
  }, [selectedMedia])
  const selectedTrashIncludesFolderRoot = selectedTrashRoots.some(
    (root) => root.type === 'dir',
  )

  const clearMediaSelection = useCallback(() => {
    setSelectedMediaItems(new Map())
    setSelectionAnchorIndex(null)
    setSelectionMode(false)
  }, [])

  const handleMediaSelect = useCallback((
    item: MediaItem,
    index: number,
    modifiers: MediaSelectionModifiers,
  ) => {
    setSelectionMode(true)
    setSelectedMediaItems((current) => {
      const next = new Map(current)
      const rangeDistance = selectionAnchorIndex === null
        ? 0
        : Math.abs(index - selectionAnchorIndex)
      if (modifiers.shiftKey && selectionAnchorIndex !== null && rangeDistance <= 1000) {
        const start = Math.min(index, selectionAnchorIndex)
        const end = Math.max(index, selectionAnchorIndex)
        for (let logicalIndex = start; logicalIndex <= end; logicalIndex += 1) {
          const value = virtualCollection?.itemAt(logicalIndex) ?? items[logicalIndex]
          if (value) next.set(value.node.id, value)
        }
      } else if (next.has(item.node.id)) {
        next.delete(item.node.id)
      } else {
        next.set(item.node.id, item)
      }
      return next
    })
    setSelectionAnchorIndex(index)
  }, [items, selectionAnchorIndex, virtualCollection])

  const runSelectionAction = useCallback(async (
    action: (selectedItems: MediaItem[]) => Promise<void>,
    clearAfter = true,
  ) => {
    if (selectedMedia.length === 0 || selectionBusyRef.current) return
    selectionBusyRef.current = true
    setSelectionBusy(true)
    try {
      await action(selectedMedia)
      if (clearAfter) clearMediaSelection()
    } finally {
      selectionBusyRef.current = false
      setSelectionBusy(false)
    }
  }, [clearMediaSelection, selectedMedia])

  useEffect(() => {
    clearMediaSelection()
    setCollageDialogItems(null)
    setMovieDialogItems(null)
    if (section === 'trash') {
      setSelected(null)
      setPreviewItem(null)
      setPreviewLogicalIndex(null)
      setPendingPreviewIndex(null)
    }
  }, [
    activeMediaType,
    activePlaceID,
    collectionKey,
    clearMediaSelection,
    currentAlbum?.id,
    currentCleanupReview?.group.id,
    currentMemory?.id,
    currentPerson?.id,
    currentPet?.id,
    currentSuggestedPerson?.id,
    section,
  ])

  useEffect(() => {
    if (!selectionMode) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      clearMediaSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearMediaSelection, selectionMode])

  const activePlace = activePlaceID
    ? places.find((place) => place.id === activePlaceID)
    : undefined
  const isRootSection =
    !currentAlbum &&
    !currentSuggestedPerson &&
    !currentPerson &&
    !currentPet &&
    !currentMemory &&
    !currentCleanupReview &&
    !activePlaceID
  const showMemoriesIndex = isRootSection && section === 'memories'
  const showCleanupIndex = isRootSection && section === 'cleanup'
  const showAlbumIndex = isRootSection && section === 'albums'
  const showPlacesIndex = isRootSection && section === 'places'
  const showPeopleIndex = isRootSection && section === 'people'
  const showMediaTypeIndex = isRootSection && section === 'media-types' && !activeMediaType
  const isTrashSection = isRootSection && section === 'trash'
  const showPhotoCollection =
    !isRootSection ||
    section === 'library' ||
    section === 'favorites' ||
    isTrashSection ||
    (section === 'media-types' && Boolean(activeMediaType))
  const mediaTypeLabel = mediaGalleryMediaTypeLabel(activeMediaType)
  const cleanupRecommendedNodeID = currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? currentCleanupReview.group.recommended_keep_node_id
      : currentCleanupReview.group.recommended_node_id
    : undefined
  const pendingSuggestedPeople = suggestedPeople.filter(
    (person) => !person.review_state,
  )
  const dismissedSuggestedPeople = suggestedPeople.filter(
    (person) => person.review_state === 'dismissed',
  )
  const visibleSuggestedPeople = showDismissedSuggestions
    ? [...pendingSuggestedPeople, ...dismissedSuggestedPeople]
    : pendingSuggestedPeople

  const galleryTitle = currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? '完全重复项'
      : '连拍精选'
    : currentPet?.name || currentMemory?.title || currentAlbum?.name ||
    (currentPerson
      ? currentPerson.name || '未命名人物'
      : currentSuggestedPerson
        ? '人物建议'
        : activePlace
          ? activePlace.name
          : section === 'memories'
            ? '回忆'
            : section === 'cleanup'
              ? '清理建议'
            : section === 'albums'
            ? '相册'
            : section === 'people'
              ? '人物与宠物'
              : section === 'places'
                ? '地点'
                : section === 'favorites'
                  ? '收藏'
                  : section === 'trash'
                    ? '回收站'
                    : section === 'media-types'
                    ? mediaTypeLabel || '媒体类型'
                    : '图库')
  const gallerySubtitle = currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? `${currentCleanupReview.group.item_count.toLocaleString('zh-CN')} 个完全相同副本 · ${currentCleanupReview.group.recommendation_reason}`
      : `${currentCleanupReview.group.item_count.toLocaleString('zh-CN')} 张连拍 · ${currentCleanupReview.group.recommendation_reason}`
    : currentPet
      ? `${currentPet.item_count.toLocaleString('zh-CN')} 张照片 · 本地视觉类型集合`
    : currentMemory
    ? currentMemory.subtitle || `${currentMemory.item_count.toLocaleString('zh-CN')} 个项目`
    : currentAlbum
    ? `${currentAlbum.item_count.toLocaleString('zh-CN')} 个项目`
    : currentPerson
      ? `${currentPerson.item_count.toLocaleString('zh-CN')} 张照片 · 长期人物${currentPerson.hidden ? ' · 已隐藏' : ''}`
      : currentSuggestedPerson
        ? `${currentSuggestedPerson.item_count.toLocaleString('zh-CN')} 张照片 · 自动聚类建议`
        : activePlace
          ? `${activePlace.item_count.toLocaleString('zh-CN')} 个项目 · 本地 GPS`
          : section === 'memories'
            ? '近期、往年今日与行程回忆'
            : section === 'cleanup'
              ? '完全重复项与连拍精选；清理操作仍然先进入回收站'
            : section === 'albums'
            ? '手动相册、智能相册和导入相册'
            : section === 'people'
              ? '已确认人物、待审核建议与本地宠物类型集合'
              : section === 'places'
                ? '按照片本地 GPS 与本地地名索引浏览'
                : section === 'favorites'
                  ? '你收藏的照片和视频'
                  : section === 'trash'
                    ? '最近删除的照片和视频；可恢复或永久删除'
                    : section === 'media-types'
                    ? mediaTypeLabel
                      ? `正在浏览${mediaTypeLabel}`
                      : '按媒体资产类型快速进入照片集合'
                    : '所有 xDrive 图片和视频，包括普通上传和同步文件夹文件'
  const canBack = Boolean(
    currentCleanupReview ||
    currentPet ||
    currentMemory ||
    currentAlbum ||
    currentSuggestedPerson ||
    currentPerson ||
    activePlaceID ||
    (section === 'media-types' && activeMediaType),
  )
  const collectionSetFavorite = isTrashSection ? undefined : onSetFavorite
  const collectionPreviewURL = isTrashSection ? undefined : loadPreviewURL

  return (
    <Stack
      spacing={2}
      sx={{
        minWidth: 0,
        pr: { lg: selected ? '380px' : 0 },
        transition: 'padding-right 160ms ease',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        {canBack && onBack ? (
          <Tooltip title="返回上一级">
            <IconButton onClick={onBack} size="small" aria-label="返回上一级">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={700} noWrap>
            {galleryTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {gallerySubtitle}
          </Typography>
        </Box>
        {showAlbumIndex && onCreateAlbum ? (
          <Button size="small" variant="outlined" onClick={() => openAlbumDialog('create')}>
            新建相册
          </Button>
        ) : null}
        {(currentAlbum?.kind === 'manual' || currentAlbum?.kind === 'smart') && onRenameAlbum ? (
          <Button size="small" variant="text" onClick={() => openAlbumDialog('rename', currentAlbum)}>
            重命名
          </Button>
        ) : null}
        {(currentAlbum?.kind === 'manual' || currentAlbum?.kind === 'smart') && onDeleteAlbum ? (
          <Button size="small" color="error" variant="text" onClick={() => setDeleteAlbumOpen(true)}>
            删除相册
          </Button>
        ) : null}
        {currentSuggestedPerson && onAdoptSuggestedPerson ? (
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              setPersonName('')
              setPersonDialogError('')
              setPersonNameDialog({ mode: 'adopt', suggestion: currentSuggestedPerson })
            }}
          >
            保存为人物
          </Button>
        ) : null}
        {currentPerson && onRenamePerson ? (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setPersonName(currentPerson.name)
              setPersonDialogError('')
              setPersonNameDialog({ mode: 'rename', person: currentPerson })
            }}
          >
            重命名
          </Button>
        ) : null}
        {currentPerson && onTogglePersonHidden ? (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              void onTogglePersonHidden(currentPerson).catch(() => undefined)
            }}
          >
            {currentPerson.hidden ? '取消隐藏' : '隐藏'}
          </Button>
        ) : null}
        {currentPerson && onMergePeople && people.some((person) => person.id !== currentPerson.id) ? (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setMergePersonIDs([])
              setPersonDialogError('')
              setMergeDialogOpen(true)
            }}
          >
            合并
          </Button>
        ) : null}
        {currentPerson && onSplitPerson && currentPerson.item_count > 1 ? (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setSplitNodeIDs([])
              setSplitName('')
              setPersonDialogError('')
              setSplitDialogOpen(true)
            }}
          >
            拆分
          </Button>
        ) : null}
        {showPhotoCollection ? (
          <Button
            size="small"
            variant={selectionMode ? 'contained' : 'text'}
            onClick={() => {
              if (selectionMode) clearMediaSelection()
              else setSelectionMode(true)
            }}
          >
            {selectionMode ? '完成' : '选择'}
          </Button>
        ) : null}
        {showPhotoCollection && !isTrashSection && !searchActive && !currentCleanupReview ? (
          <Stack direction="row" spacing={0.5} aria-label="图库时间尺度">
            {([
              ['year', '年'],
              ['month', '月'],
              ['day', '日'],
              ['all', '所有照片'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                size="small"
                variant={effectiveTimeScale === value ? 'contained' : 'text'}
                aria-pressed={effectiveTimeScale === value}
                data-xdrive-gallery-time-scale={value}
                onClick={() => setTimeScale(value)}
              >
                {label}
              </Button>
            ))}
          </Stack>
        ) : null}
        {onRefresh ? (
          <Tooltip title="刷新">
            <span>
              <IconButton
                onClick={onRefresh}
                disabled={loading}
                aria-label="刷新图库"
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>

      {onSectionChange ? (
        <XDriveMediaGalleryNavigation value={section} onChange={onSectionChange} />
      ) : null}

      {showPhotoCollection && !isTrashSection && !currentMemory && !currentPet && !currentCleanupReview
        ? filters
        : null}

      {showPhotoCollection && selectionMode ? (
        <XDriveMediaGallerySelectionToolbar
          selectedCount={selectedMedia.length}
          allFavorite={allSelectedFavorite}
          albums={albums}
          trashRootCount={selectedTrashRoots.length}
          trashIncludesFolderRoot={selectedTrashIncludesFolderRoot}
          busy={selectionBusy}
          onFavorite={!isTrashSection && onSetFavoriteBatch
            ? (favorite) => runSelectionAction(
                (selectedItems) => onSetFavoriteBatch(selectedItems, favorite),
              )
            : undefined}
          onRestore={isTrashSection && onRestoreTrashItems
            ? () => runSelectionAction(onRestoreTrashItems)
            : undefined}
          onPermanentDelete={isTrashSection && onPermanentlyDeleteTrashItems
            ? () => runSelectionAction(onPermanentlyDeleteTrashItems)
            : undefined}
          onAddToAlbum={!isTrashSection && onAddItemsToAlbum
            ? (album) => runSelectionAction(
                (selectedItems) => onAddItemsToAlbum(album, selectedItems),
              )
            : undefined}
          onAddTags={!isTrashSection && onAddTagsBatch
            ? (tags) => runSelectionAction(
                (selectedItems) => onAddTagsBatch(selectedItems, tags),
              )
            : undefined}
          onDownload={!isTrashSection && onDownloadItems
            ? () => runSelectionAction(onDownloadItems, false)
            : undefined}
          onCreateCollage={
            !isTrashSection &&
            collageSelectionEligible &&
            onCreateCreativeGeneration &&
            onGetCreativeGeneration &&
            loadPreviewURL
              ? () => setCollageDialogItems([...selectedMedia])
              : undefined
          }
          onCreateMovie={
            !isTrashSection &&
            movieSelectionEligible &&
            onCreateCreativeGeneration &&
            onGetCreativeGeneration &&
            loadPreviewURL
              ? () => setMovieDialogItems([...selectedMedia])
              : undefined
          }
          onDelete={!isTrashSection && onDeleteItems
            ? () => runSelectionAction(onDeleteItems)
            : undefined}
          onClear={clearMediaSelection}
        />
      ) : null}

      {showPhotoCollection ? (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          justifyContent="flex-end"
          sx={{ minWidth: 0 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            缩略图大小
          </Typography>
          <Slider
            size="small"
            aria-label="缩略图密度"
            min={96}
            max={240}
            step={24}
            value={minTileWidth}
            onChange={(_event, value) => {
              if (typeof value === 'number') setMinTileWidth(value)
            }}
            sx={{ width: 132 }}
          />
        </Stack>
      ) : null}

      {error ? (
        <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
      ) : null}

      {showMemoriesIndex ? (
        <XDriveMediaGalleryMemories
          memories={memories}
          loading={loading}
          loadThumbnail={loadThumbnail}
          onOpenMemory={onOpenMemory}
        />
      ) : null}

      {showCleanupIndex ? (
        <XDriveMediaGalleryCleanup
          duplicates={duplicateGroups}
          bursts={burstReviews}
          loading={loading}
          loadThumbnail={loadThumbnail}
          onOpenDuplicate={onOpenDuplicateGroup}
          onOpenBurst={onOpenBurstReview}
        />
      ) : null}

      {showAlbumIndex && albums.length > 0 ? (
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
            相册
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
          >
            {albums.map((album) => (
              <Paper
                key={album.id}
                variant="outlined"
                role={onOpenAlbum ? 'button' : undefined}
                tabIndex={onOpenAlbum ? 0 : undefined}
                onClick={() => onOpenAlbum?.(album)}
                onKeyDown={(event) => {
                  if (onOpenAlbum) keyboardActivate(event, () => onOpenAlbum(album))
                }}
                sx={{
                  overflow: 'hidden',
                  cursor: onOpenAlbum ? 'pointer' : 'default',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  '&:hover': onOpenAlbum
                    ? { transform: 'translateY(-1px)', boxShadow: 2 }
                    : undefined,
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
              >
                <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
                  <XDriveMediaAsyncThumbnail
                    nodeID={album.cover_node_id}
                    alt={album.name}
                    loadThumbnail={loadThumbnail}
                    fallback={(
                      <Box
                        sx={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'action.hover',
                          color: 'text.secondary',
                        }}
                      >
                        <CollectionsIcon sx={{ fontSize: 44 }} />
                      </Box>
                    )}
                  />
                </Box>
                <Box sx={{ px: 1.5, py: 1.2 }}>
                  <Typography variant="body2" fontWeight={650} noWrap>
                    {album.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {album.item_count.toLocaleString('zh-CN')} 个项目
                    {album.kind === 'imported'
                      ? ' · 导入相册'
                      : album.kind === 'manual'
                        ? ' · 手动相册'
                        : album.kind === 'smart'
                          ? ' · 智能相册'
                          : ''}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      {showPlacesIndex && places.length > 0 ? (
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.75}
            alignItems={{ xs: 'flex-start', sm: 'baseline' }}
          >
            <Typography variant="subtitle1" fontWeight={700}>
              地点
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {places.some((place) => place.attribution)
                ? '按本地 GPS 聚合；地点名称来自本地 GeoNames 数据'
                : '按本地 GPS 坐标近似聚合，不使用在线地理服务'}
            </Typography>
          </Stack>

          <XDriveMediaGalleryPlacesMap
            places={places}
            activePlaceID={activePlaceID}
            onOpenPlace={onOpenPlace}
          />

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25 }}>
              地点列表
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 1.5,
              }}
            >
              {places.slice(0, 24).map((place) => (
                <Paper
                  key={place.id}
                  variant="outlined"
                  role={onOpenPlace ? 'button' : undefined}
                  tabIndex={onOpenPlace ? 0 : undefined}
                  onClick={() => onOpenPlace?.(place)}
                  onKeyDown={(event) => {
                    if (onOpenPlace) keyboardActivate(event, () => onOpenPlace(place))
                  }}
                  sx={{
                    overflow: 'hidden',
                    cursor: onOpenPlace ? 'pointer' : 'default',
                    borderColor: activePlaceID === place.id ? 'primary.main' : 'divider',
                    transition: 'transform 120ms ease, box-shadow 120ms ease',
                    '&:hover': onOpenPlace
                      ? { transform: 'translateY(-1px)', boxShadow: 2 }
                      : undefined,
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
                    <XDriveMediaAsyncThumbnail
                      nodeID={place.cover_node_id}
                      alt={place.name}
                      loadThumbnail={loadThumbnail}
                      fallback={xDriveMediaFallback('image')}
                    />
                  </Box>
                  <Box sx={{ px: 1.5, py: 1.2 }}>
                    <Typography variant="body2" fontWeight={650} noWrap>
                      {place.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {place.item_count.toLocaleString('zh-CN')} 个项目 · 本地 GPS
                      {place.attribution ? ` · ${place.attribution}` : ''}
                    </Typography>
                  </Box>
                </Paper>
              ))}
            </Box>
          </Box>
        </Stack>
      ) : null}

      {showPeopleIndex ? (
        <XDriveMediaGalleryPets
          pets={pets}
          loadThumbnail={loadThumbnail}
          onOpenPet={onOpenPet}
        />
      ) : null}

      {showPeopleIndex && people.length > 0 ? (
        <Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
            sx={{ mb: 1.25 }}
          >
            <Stack direction="row" spacing={0.75} alignItems="baseline">
              <Typography variant="subtitle1" fontWeight={700}>
                已确认人物
              </Typography>
              <Typography variant="caption" color="text.secondary">
                已保存的长期人物，不受自动聚类重建影响
              </Typography>
            </Stack>
            {people.some((person) => person.hidden) ? (
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={showHiddenPeople}
                    onChange={(event) => setShowHiddenPeople(event.target.checked)}
                  />
                )}
                label="显示已隐藏"
              />
            ) : null}
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {people
              .filter((person) => !person.hidden || showHiddenPeople)
              .map((person) => (
                <Paper
                  key={person.id}
                  variant="outlined"
                  role={onOpenPerson ? 'button' : undefined}
                  tabIndex={onOpenPerson ? 0 : undefined}
                  onClick={() => onOpenPerson?.(person)}
                  onKeyDown={(event) => {
                    if (onOpenPerson) keyboardActivate(event, () => onOpenPerson(person))
                  }}
                  sx={{
                    overflow: 'hidden',
                    cursor: onOpenPerson ? 'pointer' : 'default',
                    opacity: person.hidden ? 0.68 : 1,
                    transition: 'transform 120ms ease, box-shadow 120ms ease',
                    '&:hover': onOpenPerson
                      ? { transform: 'translateY(-1px)', boxShadow: 2 }
                      : undefined,
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box sx={{ aspectRatio: '1 / 1', overflow: 'hidden' }}>
                    <XDriveMediaAsyncThumbnail
                      nodeID={person.cover_node_id}
                      alt={person.name || '未命名人物'}
                      loadThumbnail={loadThumbnail}
                      fallback={(
                        <Box
                          sx={{
                            width: '100%',
                            height: '100%',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'action.hover',
                            color: 'text.secondary',
                          }}
                        >
                          <PersonOutlineIcon sx={{ fontSize: 44 }} />
                        </Box>
                      )}
                    />
                  </Box>
                  <Box sx={{ px: 1.5, py: 1.2 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="body2" fontWeight={650} noWrap sx={{ flex: 1 }}>
                        {person.name || '未命名人物'}
                      </Typography>
                      {person.hidden ? <Chip size="small" label="已隐藏" /> : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {person.item_count.toLocaleString('zh-CN')} 张照片
                    </Typography>
                  </Box>
                </Paper>
              ))}
          </Box>
        </Box>
      ) : null}

      {showPeopleIndex && (
        pendingSuggestedPeople.length > 0 ||
        dismissedSuggestedPeople.length > 0
      ) ? (
        <Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
            sx={{ mb: 1.25 }}
          >
            <Stack direction="row" spacing={0.75} alignItems="baseline">
              <Typography variant="subtitle1" fontWeight={700}>
                待确认建议
              </Typography>
              <Typography variant="caption" color="text.secondary">
                本地人脸聚类快照；确认后成为长期人物
              </Typography>
            </Stack>
            {dismissedSuggestedPeople.length > 0 ? (
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={showDismissedSuggestions}
                    onChange={(event) => setShowDismissedSuggestions(event.target.checked)}
                  />
                )}
                label="显示暂不处理"
              />
            ) : null}
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {visibleSuggestedPeople.map((person) => (
              <Paper
                key={person.id}
                variant="outlined"
                role={onOpenSuggestedPerson ? 'button' : undefined}
                tabIndex={onOpenSuggestedPerson ? 0 : undefined}
                onClick={() => onOpenSuggestedPerson?.(person)}
                onKeyDown={(event) => {
                  if (onOpenSuggestedPerson) {
                    keyboardActivate(event, () => onOpenSuggestedPerson(person))
                  }
                }}
                sx={{
                  overflow: 'hidden',
                  cursor: onOpenSuggestedPerson ? 'pointer' : 'default',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  '&:hover': onOpenSuggestedPerson
                    ? { transform: 'translateY(-1px)', boxShadow: 2 }
                    : undefined,
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
              >
                <Box sx={{ aspectRatio: '1 / 1', overflow: 'hidden' }}>
                  <XDriveMediaAsyncThumbnail
                    nodeID={person.cover_node_id}
                    alt="人物建议"
                    loadThumbnail={loadThumbnail}
                    fallback={(
                      <Box
                        sx={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'action.hover',
                          color: 'text.secondary',
                        }}
                      >
                        <PersonOutlineIcon sx={{ fontSize: 44 }} />
                      </Box>
                    )}
                  />
                </Box>
                <Box sx={{ px: 1.5, py: 1.2 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2" fontWeight={650} noWrap sx={{ flex: 1 }}>
                      未命名人物
                    </Typography>
                    {person.review_state === 'dismissed' ? (
                      <Chip size="small" label="暂不处理" />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {person.item_count.toLocaleString('zh-CN')} 张照片
                    {person.face_count !== person.item_count
                      ? ` · ${person.face_count.toLocaleString('zh-CN')} 张脸`
                      : ''}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    useFlexGap
                    flexWrap="wrap"
                    sx={{ mt: 0.5 }}
                  >
                    {person.review_state === 'dismissed' ? (
                      onReviewSuggestedPerson ? (
                        <Button
                          size="small"
                          variant="text"
                          disabled={suggestionReviewBusyID === person.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSuggestionReviewBusyID(person.id)
                            void onReviewSuggestedPerson(person, 'pending')
                              .catch(() => undefined)
                              .finally(() => setSuggestionReviewBusyID(null))
                          }}
                        >
                          恢复
                        </Button>
                      ) : null
                    ) : (
                      <>
                        {onAdoptSuggestedPerson ? (
                          <Button
                            size="small"
                            variant="text"
                            onClick={(event) => {
                              event.stopPropagation()
                              setPersonName('')
                              setPersonDialogError('')
                              setPersonNameDialog({ mode: 'adopt', suggestion: person })
                            }}
                          >
                            保存为人物
                          </Button>
                        ) : null}
                        {onAddSuggestedPersonToPerson &&
                        people.some((value) => !value.hidden) ? (
                          <Button
                            size="small"
                            variant="text"
                            onClick={(event) => {
                              event.stopPropagation()
                              setPersonDialogError('')
                              setSuggestionTargetDialog(person)
                            }}
                          >
                            添加到已有人物
                          </Button>
                        ) : null}
                        {onReviewSuggestedPerson ? (
                          <Button
                            size="small"
                            variant="text"
                            color="inherit"
                            disabled={suggestionReviewBusyID === person.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSuggestionReviewBusyID(person.id)
                              void onReviewSuggestedPerson(person, 'dismissed')
                                .catch(() => undefined)
                                .finally(() => setSuggestionReviewBusyID(null))
                            }}
                          >
                            暂不处理
                          </Button>
                        ) : null}
                      </>
                    )}
                  </Stack>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      {showMediaTypeIndex ? (
        <Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
          >
            {mediaGalleryMediaTypes.map((mediaType) => (
              <Paper
                key={mediaType.value}
                variant="outlined"
                role={onOpenMediaType ? 'button' : undefined}
                tabIndex={onOpenMediaType ? 0 : undefined}
                onClick={() => onOpenMediaType?.(mediaType.value)}
                onKeyDown={(event) => {
                  if (onOpenMediaType) {
                    keyboardActivate(event, () => onOpenMediaType(mediaType.value))
                  }
                }}
                sx={{
                  p: 2,
                  minHeight: 132,
                  cursor: onOpenMediaType ? 'pointer' : 'default',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  '&:hover': onOpenMediaType
                    ? { transform: 'translateY(-1px)', boxShadow: 2 }
                    : undefined,
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
              >
                <Stack spacing={1}>
                  <Box sx={{ color: 'text.secondary' }}>
                    {mediaType.value === 'video'
                      ? <MovieIcon />
                      : mediaType.value === 'live_photo'
                        ? <XDriveLivePhotoGlyph size={20} />
                        : <ImageIcon />}
                  </Box>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {mediaType.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {mediaType.description}
                  </Typography>
                </Stack>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      {showPhotoCollection ? (
        <Box>
        {isRootSection && section === 'library' ? (
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
            所有照片和视频
          </Typography>
        ) : null}
        {loading && logicalItemCount === 0 ? (
          <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : logicalItemCount === 0 ? (
          <Paper
            variant="outlined"
            sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
          >
            <Stack alignItems="center" spacing={1}>
              <ImageIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography color="text.secondary">
                {isTrashSection ? '回收站为空' : '没有可显示的图片或视频'}
              </Typography>
            </Stack>
          </Paper>
        ) : !isTrashSection && timeScale !== 'all' ? (
          virtualCollection ? (
            <MediaVirtualTimeline
              groups={activeTimelineGroups}
              collection={virtualCollection}
              minTileWidth={minTileWidth}
              loadThumbnail={loadThumbnail}
              thumbnailScheduler={thumbnailScheduler}
              loadPreviewURL={collectionPreviewURL}
              onSetFavorite={collectionSetFavorite}
              onSetCover={
                currentPerson && onSetPersonCover
                  ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                  : undefined
              }
              selectionMode={selectionMode}
              selectedNodeIDs={selectedNodeIDs}
              onSelect={handleMediaSelect}
              onOpen={openMediaItem}
              onPreview={openMediaPreview}
              onToggleFavorite={toggleMediaFavorite}
            />
          ) : (
            <Stack spacing={2.5}>
              {denseTimelineGroups.map((group) => (
                <Box key={group.key}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="baseline"
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="subtitle1" fontWeight={700}>
                      {group.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {group.items.length.toLocaleString('zh-CN')} 项
                    </Typography>
                  </Stack>
                  <MediaTileGrid
                    items={group.items}
                    minTileWidth={minTileWidth}
                    indexOffset={group.startIndex}
                    selectionMode={selectionMode}
                    selectedNodeIDs={selectedNodeIDs}
                    onSelect={handleMediaSelect}
                    loadThumbnail={loadThumbnail}
                    loadPreviewURL={collectionPreviewURL}
                    onSetFavorite={collectionSetFavorite}
                    onSetCover={
                      currentPerson && onSetPersonCover
                        ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                        : undefined
                    }
                    onOpen={openMediaItem}
                    onPreview={openMediaPreview}
                    onToggleFavorite={toggleMediaFavorite}
                  />
                </Box>
              ))}
            </Stack>
          )
        ) : virtualCollection ? (
          <MediaVirtualTileGrid
            collection={virtualCollection}
            minTileWidth={minTileWidth}
            selectionMode={selectionMode}
            selectedNodeIDs={selectedNodeIDs}
            onSelect={handleMediaSelect}
            loadThumbnail={loadThumbnail}
            thumbnailScheduler={thumbnailScheduler}
            loadPreviewURL={collectionPreviewURL}
            onSetFavorite={collectionSetFavorite}
            onSetCover={
              currentPerson && onSetPersonCover
                ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                : undefined
            }
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
            recommendedNodeID={cleanupRecommendedNodeID}
          />
        ) : (
          <MediaTileGrid
            items={items}
            minTileWidth={minTileWidth}
            selectionMode={selectionMode}
            selectedNodeIDs={selectedNodeIDs}
            onSelect={handleMediaSelect}
            loadThumbnail={loadThumbnail}
            loadPreviewURL={collectionPreviewURL}
            onSetFavorite={collectionSetFavorite}
            onSetCover={
              currentPerson && onSetPersonCover
                ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                : undefined
            }
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
            recommendedNodeID={cleanupRecommendedNodeID}
          />
        )}
        </Box>
      ) : null}

      {showAlbumIndex && albums.length === 0 && !loading ? (
        <Paper variant="outlined" sx={{ minHeight: 160, display: 'grid', placeItems: 'center', p: 3 }}>
          <Typography color="text.secondary">还没有相册</Typography>
        </Paper>
      ) : null}
      {showPlacesIndex && places.length === 0 && !loading ? (
        <Paper variant="outlined" sx={{ minHeight: 160, display: 'grid', placeItems: 'center', p: 3 }}>
          <Typography color="text.secondary">没有带地点信息的照片</Typography>
        </Paper>
      ) : null}
      {showPeopleIndex &&
      people.length === 0 &&
      suggestedPeople.length === 0 &&
      pets.length === 0 &&
      !loading ? (
        <Paper variant="outlined" sx={{ minHeight: 160, display: 'grid', placeItems: 'center', p: 3 }}>
          <Typography color="text.secondary">还没有可浏览的人物</Typography>
        </Paper>
      ) : null}

      <XDriveMediaGalleryCollageDialog
        open={Boolean(collageDialogItems)}
        items={collageDialogItems ?? []}
        loadThumbnail={loadThumbnail}
        loadPreviewURL={loadPreviewURL}
        onCreate={onCreateCreativeGeneration}
        onGet={onGetCreativeGeneration}
        onCancel={onCancelCreativeGeneration}
        onCompleted={() => {
          clearMediaSelection()
          if (onRefresh) onRefresh()
        }}
        onClose={() => setCollageDialogItems(null)}
      />

      <XDriveMediaGalleryMovieDialog
        open={Boolean(movieDialogItems)}
        items={movieDialogItems ?? []}
        loadThumbnail={loadThumbnail}
        loadPreviewURL={loadPreviewURL}
        onCreate={onCreateCreativeGeneration}
        onGet={onGetCreativeGeneration}
        onCancel={onCancelCreativeGeneration}
        onCompleted={() => {
          clearMediaSelection()
          if (onRefresh) onRefresh()
        }}
        onClose={() => setMovieDialogItems(null)}
      />

      <XDriveMediaGalleryViewer
        item={previewItem}
        positionLabel={previewIndex >= 0 ? `${previewIndex + 1} / ${logicalItemCount}` : undefined}
        canPrevious={previewIndex > 0}
        canNext={previewIndex >= 0 && previewIndex < logicalItemCount - 1}
        filmstripEntries={previewFilmstripEntries}
        activeIndex={previewIndex}
        loadThumbnail={loadThumbnail}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPreviewURL={loadPreviewURL}
        onPrevious={() => requestPreviewIndex(previewIndex - 1)}
        onNext={() => requestPreviewIndex(previewIndex + 1)}
        onFilmstripSelect={requestPreviewIndex}
        onToggleFavorite={onSetFavorite ? toggleFavorite : undefined}
        onInfo={openPreviewInfo}
        onSaveEditRecipe={onSaveEditRecipe ? saveLocalEditRecipe : undefined}
        onResetEditRecipe={onResetEditRecipe ? resetLocalEditRecipe : undefined}
        onCreateCreativeGeneration={onCreateCreativeGeneration}
        onGetCreativeGeneration={onGetCreativeGeneration}
        onCancelCreativeGeneration={onCancelCreativeGeneration}
        onCreativeCompleted={onRefresh
          ? () => onRefresh()
          : undefined}
        onDownload={onDownloadItems
          ? (item) => onDownloadItems([item])
          : undefined}
        onShare={onShareItem}
        onDelete={onDeleteItems
          ? (item) => onDeleteItems([item])
          : undefined}
        onClose={closeMediaPreview}
      />

      <XDriveMediaDetailsInspector
        item={selected}
        loadThumbnail={loadThumbnail}
        loadLivePhotoMotion={isTrashSection ? undefined : loadLivePhotoMotion}
        loadPreviewURL={isTrashSection ? undefined : loadPreviewURL}
        albums={albums}
        currentAlbum={currentAlbum}
        onAddToAlbum={isTrashSection ? undefined : onAddToAlbum}
        onRemoveFromAlbum={isTrashSection ? undefined : onRemoveFromAlbum}
        onSetFavorite={!isTrashSection && onSetFavorite ? async (item, favorite) => {
          await onSetFavorite(item, favorite)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, favorite }
              : current
          ))
        } : undefined}
        onSetTags={!isTrashSection && onSetTags ? async (item, tags) => {
          const normalized = await onSetTags(item, tags)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, tags: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onSetPeople={!isTrashSection && onSetPeople ? async (item, people) => {
          const normalized = await onSetPeople(item, people)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, people: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onSetDescription={!isTrashSection && onSetDescription ? async (item, description) => {
          const normalized = await onSetDescription(item, description)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, description: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onClose={() => setSelected(null)}
      />
      <Dialog
        open={Boolean(albumDialog)}
        onClose={() => !albumDialogBusy && setAlbumDialog(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={albumDialog?.mode === 'rename' ? '重命名相册' : '新建相册'}
          onClose={() => !albumDialogBusy && setAlbumDialog(null)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="相册名称"
              value={albumName}
              onChange={(event) => {
                setAlbumName(event.target.value)
                setAlbumDialogError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && albumName.trim() && !albumDialogBusy) {
                  event.preventDefault()
                  const task = albumDialog?.mode === 'rename' && albumDialog.album && onRenameAlbum
                    ? onRenameAlbum(albumDialog.album, albumName.trim())
                    : onCreateAlbum
                      ? onCreateAlbum(albumName.trim())
                      : Promise.reject(new Error('当前客户端不支持相册编辑'))
                  setAlbumDialogBusy(true)
                  void task
                    .then(() => setAlbumDialog(null))
                    .catch((error) => setAlbumDialogError(xDriveMediaGalleryErrorMessage(error)))
                    .finally(() => setAlbumDialogBusy(false))
                }
              }}
            />
            {albumDialogError ? <XDriveStatusAlert tone="bad">{albumDialogError}</XDriveStatusAlert> : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setAlbumDialog(null)} disabled={albumDialogBusy}>取消</Button>
          <Button
            variant="contained"
            disabled={!albumName.trim() || albumDialogBusy}
            onClick={() => {
              const task = albumDialog?.mode === 'rename' && albumDialog.album && onRenameAlbum
                ? onRenameAlbum(albumDialog.album, albumName.trim())
                : onCreateAlbum
                  ? onCreateAlbum(albumName.trim())
                  : Promise.reject(new Error('当前客户端不支持相册编辑'))
              setAlbumDialogBusy(true)
              setAlbumDialogError('')
              void task
                .then(() => setAlbumDialog(null))
                .catch((error) => setAlbumDialogError(xDriveMediaGalleryErrorMessage(error)))
                .finally(() => setAlbumDialogBusy(false))
            }}
          >
            {albumDialog?.mode === 'rename' ? '保存' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteAlbumOpen}
        onClose={() => !albumDialogBusy && setDeleteAlbumOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="删除相册"
          onClose={() => !albumDialogBusy && setDeleteAlbumOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Typography variant="body2">
            {currentAlbum?.kind === 'smart'
              ? `删除智能相册“${currentAlbum?.name || ''}”只会删除保存的筛选规则，不会删除照片或视频。`
              : `删除手动相册“${currentAlbum?.name || ''}”只会删除相册关系，不会删除其中的照片或视频。`}
          </Typography>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAlbumOpen(false)} disabled={albumDialogBusy}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!currentAlbum || albumDialogBusy || !onDeleteAlbum}
            onClick={() => {
              if (!currentAlbum || !onDeleteAlbum) return
              setAlbumDialogBusy(true)
              void onDeleteAlbum(currentAlbum)
                .then(() => setDeleteAlbumOpen(false))
                .catch((error) => setAlbumDialogError(xDriveMediaGalleryErrorMessage(error)))
                .finally(() => setAlbumDialogBusy(false))
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(personNameDialog)}
        onClose={() => !personDialogBusy && setPersonNameDialog(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={personNameDialog?.mode === 'rename' ? '重命名人物' : '保存为人物'}
          subtitle={personNameDialog?.mode === 'adopt'
            ? '保存后成为长期人物，不再受自动聚类重建影响。'
            : '名称可以留空，长期人物身份仍会保留。'}
          onClose={() => !personDialogBusy && setPersonNameDialog(null)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="人物名称"
              value={personName}
              onChange={(event) => {
                setPersonName(event.target.value)
                setPersonDialogError('')
              }}
              placeholder="可留空"
            />
            {personDialogError ? (
              <XDriveStatusAlert tone="bad">{personDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button
            disabled={personDialogBusy}
            onClick={() => setPersonNameDialog(null)}
          >
            取消
          </Button>
          <Button
            variant="contained"
            disabled={personDialogBusy}
            onClick={() => {
              const task = personNameDialog?.mode === 'adopt' &&
                personNameDialog.suggestion &&
                onAdoptSuggestedPerson
                ? onAdoptSuggestedPerson(personNameDialog.suggestion, personName.trim())
                : personNameDialog?.mode === 'rename' &&
                    personNameDialog.person &&
                    onRenamePerson
                  ? onRenamePerson(personNameDialog.person, personName.trim())
                  : Promise.reject(new Error('当前客户端不支持人物编辑'))
              setPersonDialogBusy(true)
              setPersonDialogError('')
              void task
                .then(() => setPersonNameDialog(null))
                .catch((personError) => {
                  setPersonDialogError(xDriveMediaGalleryErrorMessage(personError))
                })
                .finally(() => setPersonDialogBusy(false))
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(suggestionTargetDialog)}
        onClose={() => !personDialogBusy && setSuggestionTargetDialog(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="添加到已有人物"
          subtitle="把这组自动聚类建议加入一个长期人物；原人物名称与 ID 保留。"
          onClose={() => !personDialogBusy && setSuggestionTargetDialog(null)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={0.75}>
            {people
              .filter((person) => !person.hidden)
              .map((person) => (
                <Button
                  key={person.id}
                  variant="outlined"
                  disabled={personDialogBusy || !onAddSuggestedPersonToPerson}
                  onClick={() => {
                    if (!suggestionTargetDialog || !onAddSuggestedPersonToPerson) return
                    setPersonDialogBusy(true)
                    setPersonDialogError('')
                    void onAddSuggestedPersonToPerson(
                      suggestionTargetDialog,
                      person,
                    )
                      .then(() => setSuggestionTargetDialog(null))
                      .catch((personError) => {
                        setPersonDialogError(xDriveMediaGalleryErrorMessage(personError))
                      })
                      .finally(() => setPersonDialogBusy(false))
                  }}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>{person.name || '未命名人物'}</span>
                  <span>{person.item_count.toLocaleString('zh-CN')} 张</span>
                </Button>
              ))}
            {people.every((person) => person.hidden) ? (
              <Typography variant="body2" color="text.secondary">
                当前没有可用的已确认人物。
              </Typography>
            ) : null}
            {personDialogError ? (
              <XDriveStatusAlert tone="bad">{personDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button
            disabled={personDialogBusy}
            onClick={() => setSuggestionTargetDialog(null)}
          >
            取消
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={mergeDialogOpen}
        onClose={() => !personDialogBusy && setMergeDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="合并人物"
          subtitle="选中的人物会合并到当前人物；当前人物 ID 和名称会保留。"
          onClose={() => !personDialogBusy && setMergeDialogOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={0.5}>
            {people
              .filter((person) => person.id !== currentPerson?.id)
              .map((person) => (
                <FormControlLabel
                  key={person.id}
                  control={(
                    <Checkbox
                      checked={mergePersonIDs.includes(person.id)}
                      onChange={(event) => {
                        setMergePersonIDs((current) => (
                          event.target.checked
                            ? [...current, person.id]
                            : current.filter((id) => id !== person.id)
                        ))
                      }}
                    />
                  )}
                  label={`${person.name || '未命名人物'} · ${person.item_count.toLocaleString('zh-CN')} 张照片`}
                />
              ))}
            {personDialogError ? (
              <XDriveStatusAlert tone="bad">{personDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button
            disabled={personDialogBusy}
            onClick={() => setMergeDialogOpen(false)}
          >
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!currentPerson || mergePersonIDs.length === 0 || personDialogBusy || !onMergePeople}
            onClick={() => {
              if (!currentPerson || !onMergePeople) return
              setPersonDialogBusy(true)
              setPersonDialogError('')
              void onMergePeople(currentPerson, mergePersonIDs)
                .then(() => setMergeDialogOpen(false))
                .catch((personError) => {
                  setPersonDialogError(xDriveMediaGalleryErrorMessage(personError))
                })
                .finally(() => setPersonDialogBusy(false))
            }}
          >
            合并
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={splitDialogOpen}
        onClose={() => !personDialogBusy && setSplitDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="拆分人物"
          subtitle="选择要移动到新人物的照片。至少要给当前人物保留一张照片。"
          onClose={() => !personDialogBusy && setSplitDialogOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1}>
            {currentPerson && currentPerson.item_count > items.length ? (
              <XDriveStatusAlert tone="warning">
                当前只加载了部分照片；如需选择更多照片，请先继续加载。
              </XDriveStatusAlert>
            ) : null}
            <TextField
              label="新人物名称"
              value={splitName}
              onChange={(event) => setSplitName(event.target.value)}
              placeholder="可留空"
            />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 1,
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {items.map((item) => (
                <FormControlLabel
                  key={item.node.id}
                  control={(
                    <Checkbox
                      checked={splitNodeIDs.includes(item.node.id)}
                      onChange={(event) => {
                        setSplitNodeIDs((current) => (
                          event.target.checked
                            ? [...current, item.node.id]
                            : current.filter((id) => id !== item.node.id)
                        ))
                      }}
                    />
                  )}
                  label={item.node.name}
                />
              ))}
            </Box>
            {personDialogError ? (
              <XDriveStatusAlert tone="bad">{personDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button
            disabled={personDialogBusy}
            onClick={() => setSplitDialogOpen(false)}
          >
            取消
          </Button>
          <Button
            variant="contained"
            disabled={
              !currentPerson ||
              splitNodeIDs.length === 0 ||
              splitNodeIDs.length >= currentPerson.item_count ||
              personDialogBusy ||
              !onSplitPerson
            }
            onClick={() => {
              if (!currentPerson || !onSplitPerson) return
              setPersonDialogBusy(true)
              setPersonDialogError('')
              void onSplitPerson(currentPerson, splitNodeIDs, splitName.trim())
                .then(() => setSplitDialogOpen(false))
                .catch((personError) => {
                  setPersonDialogError(xDriveMediaGalleryErrorMessage(personError))
                })
                .finally(() => setPersonDialogBusy(false))
            }}
          >
            拆分
          </Button>
        </DialogActions>
      </Dialog>

    </Stack>
  )
}
