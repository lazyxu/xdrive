import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  ArrowBack as ArrowBackIcon,
  FolderOutlined as FolderOutlinedIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  PersonOutline as PersonOutlineIcon,
  Refresh as RefreshIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
} from '@mui/icons-material'
import {
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  xDriveMediaDayKey,
  xDriveMediaTimeZoneChoices,
  xDriveReadMediaTimeZone,
  xDriveValidMediaTimeZone,
  xDriveWriteMediaTimeZone,
} from '../media-timezone'
import type {
  XDriveByteProgressHandler,
  XDriveLivePhotoMotionSource,
} from '../file-preview'
import type { XDriveWebAppGalleryTarget } from '../web-app'
import type {
  MediaAlbum,
  MediaAlbumFolder,
  MediaGalleryFacets,
  MediaGalleryIndexStatus,
  NodeLocation,
  MediaDuplicateOrganizePlan,
  MediaDuplicateOrganizeApplyInput,
  MediaDuplicateOrganizeApplyResult,
  MediaGalleryQuery,
  MediaSyncFolder,
  MediaFolderBreadcrumb,
  MediaFolderEntry,
  MediaFolderView,
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
  Node,
  UpdateMediaPersonIdentityInput,
} from '../models'
import { XDRIVE_MOBILE_ITEM_HOLD_MS, xDriveMobileItemMoved } from '../mobile-item-gesture'
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
  xDriveGalleryAppliedChips,
  xDriveGalleryFilterSignature,
  xDriveGalleryRecentSearches,
  xDriveGalleryRememberSearch,
} from './MediaGallerySearchModel'
import type { XDriveGalleryAppliedFilterKey } from './MediaGallerySearchModel'
import {
  XDriveMediaGalleryNavigation,
} from './MediaGalleryNavigation'
import type { MediaGallerySection } from './MediaGalleryNavigation'
import { XDriveMediaGalleryPlacesMap } from './MediaGalleryPlacesMap'
import type { XDriveMediaPlacesMapViewport } from './MediaGalleryPlacesMapModel'
import { XDriveMediaGalleryMemories } from './MediaGalleryMemories'
import { XDriveMediaGalleryCleanup } from './MediaGalleryCleanup'
import { XDriveMediaGalleryDuplicateOrganizePreview } from './MediaGalleryDuplicateOrganizePreview'
import { XDriveMediaGalleryPets } from './MediaGalleryPets'
import { XDriveMediaGallerySelectionToolbar } from './MediaGallerySelectionToolbar'
import { XDriveMediaGalleryAlbumOrganizer } from './MediaGalleryAlbumOrganizer'
import type { XDriveMediaGalleryAlbumFolderActions } from './MediaGalleryAlbumOrganizer'
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
  xDriveMediaGalleryTimelineGroupLabel,
  xDriveMediaGalleryTimelineIndexVisible,
  xDriveMediaGalleryTimelineLayout,
  xDriveMediaGalleryTimelineWindow,
} from './MediaGalleryVirtualTimeline'
import {
  xDriveMediaGalleryTimelineGroupAtIndex,
  xDriveMediaGalleryTimelineNearestDay,
} from './MediaGalleryTimelineNavigation'
import {
  XDriveMediaThumbnailScheduler,
} from './MediaGalleryThumbnailScheduler'
import type {
  XDriveMediaThumbnailPriority,
} from './MediaGalleryThumbnailScheduler'

export type MediaThumbnailLoader = (nodeID: number, signal?: AbortSignal, revision?: number) => Promise<string | null>
export type MediaMotionLoader = (
  nodeID: number,
  onProgress?: XDriveByteProgressHandler,
) => Promise<XDriveLivePhotoMotionSource | null>
export type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video' | 'live_photo',
  signal?: AbortSignal,
  fileName?: string,
  revision?: number,
) => Promise<string | null>
export type MediaVideoPosterSaver = (nodeID: number, revision: number, poster: Blob, signal?: AbortSignal) => Promise<void>

export interface MediaGalleryDataSource {
  loadMusicRoot?: () => Promise<Node>
  listMusicChildren?: (parentID: number) => Promise<Node[]>
  listItems: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listItemRange: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
    signal?: AbortSignal,
  ) => Promise<MediaItemRange>
  listFacets?: (query?: MediaGalleryQuery, albumID?: string) => Promise<MediaGalleryFacets>
  getIndexStatus?: () => Promise<MediaGalleryIndexStatus>
  getNodeLocation?: (nodeID: number, signal?: AbortSignal) => Promise<NodeLocation>
  getDuplicateOrganizePlan?: (keeperNodeID: number, nodeIDs: number[]) => Promise<MediaDuplicateOrganizePlan>
  applyDuplicateOrganize?: (input: MediaDuplicateOrganizeApplyInput) => Promise<MediaDuplicateOrganizeApplyResult>
  listSyncFolders?: () => Promise<MediaSyncFolder[]>
  getSyncFolder?: (sourceID: number, folderID: number) => Promise<MediaFolderView>
  listTrashItemRange?: (
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  restoreTrashItems?: (items: MediaItem[]) => Promise<void>
  permanentlyDeleteTrashItems?: (items: MediaItem[]) => Promise<void>
  listAlbums: () => Promise<MediaAlbum[]>
  listAlbumFolders?: () => Promise<MediaAlbumFolder[]>
  createAlbumFolder?: (name: string, parentID: number) => Promise<MediaAlbumFolder>
  updateAlbumFolder?: (
    folderID: number, revision: number, change: { name?: string; parent_id?: number },
  ) => Promise<MediaAlbumFolder>
  deleteAlbumFolder?: (folderID: number, revision: number) => Promise<void>
  moveAlbumToFolder?: (albumID: string, revision: number, folderID: number) => Promise<MediaAlbum>
  listPlaces?: (limit?: number) => Promise<MediaPlaceFacet[]>
  listMemories?: (anchorDate?: string, limit?: number, timeZone?: string) => Promise<MediaMemory[]>
  listMemoryItemRange?: (
    memoryID: string,
    limit: number,
    offset: number,
    timeZone?: string,
  ) => Promise<MediaItemRange>
  listDuplicateGroups?: (limit?: number, offset?: number) => Promise<MediaDuplicateGroupList>
  listDuplicateItemRange?: (
    duplicateID: string,
    limit: number,
    offset: number,
  ) => Promise<MediaItemRange>
  listBurstReviews?: (limit?: number, offset?: number) => Promise<MediaBurstReviewList>
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
  saveVideoPoster?: MediaVideoPosterSaver
  setFavorite?: (nodeID: number, favorite: boolean) => Promise<void>
  setFavoriteBatch?: (nodeIDs: number[], favorite: boolean) => Promise<void>
  addTagsBatch?: (nodeIDs: number[], tags: string[]) => Promise<void>
  deleteItems?: (items: MediaItem[]) => Promise<void>
  downloadItems?: (items: MediaItem[]) => Promise<void>
  exportLivePhoto?: (item: MediaItem) => Promise<void>
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
  setAlbumCover?: (albumID: string, revision: number, nodeID: number) => Promise<MediaAlbum>
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
  preferenceScope?: string
  pageSize?: number
  shareDialog?: XDriveMediaGalleryShareDialogOptions
  initialSection?: MediaGallerySection
  onSectionRouteChange?: (section: MediaGallerySection) => void
  onOpenViewer?: (item: MediaItem, context: XDriveMediaGalleryOpenViewerContext) => void
  onShowInFolder?: (location: NodeLocation) => void
  onError?: (error: unknown) => void
}

export function XDriveMediaGalleryPage({
  source,
  preferenceScope = '',
  pageSize = 100,
  shareDialog,
  initialSection,
  onSectionRouteChange,
  onOpenViewer,
  onShowInFolder,
  onError,
}: XDriveMediaGalleryPageProps) {
  const [facets, setFacets] = useState<MediaGalleryFacets>({ cameras: [], formats: [] })
  const [facetsLoading, setFacetsLoading] = useState(false)
  const [facetsError, setFacetsError] = useState('')
  const facetRequestID = useRef(0)
  const indexRequestID = useRef(0)
  const [indexStatus, setIndexStatus] = useState<MediaGalleryIndexStatus | null>(null)
  const [indexStatusLoading, setIndexStatusLoading] = useState(false)
  const [indexStatusError, setIndexStatusError] = useState('')
  const syncFolderRequestID = useRef(0)
  const [syncFolders, setSyncFolders] = useState<MediaSyncFolder[]>([])
  const [syncFoldersLoading, setSyncFoldersLoading] = useState(false)
  const [syncFoldersError, setSyncFoldersError] = useState('')
  const [currentFolderView, setCurrentFolderView] = useState<MediaFolderView | null>(null)
  const [albums, setAlbums] = useState<MediaAlbum[]>([])
  const [places, setPlaces] = useState<MediaPlaceFacet[]>([])
  const [placesStatus, setPlacesStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [memories, setMemories] = useState<MediaMemory[]>([])
  const [burstReviews, setBurstReviews] =
    useState<MediaBurstReviewList | null>(null)
  const [cleanupMoreLoading, setCleanupMoreLoading] = useState<'burst' | null>(null)
  const cleanupMoreInFlightRef = useRef(false)
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
  useEffect(() => {
    indexRequestID.current += 1
    setIndexStatus(null)
    setIndexStatusLoading(false)
    setIndexStatusError('')
  }, [preferenceScope])

  const [query, setQuery] = useState<MediaGalleryQuery>({})
  const [foldDuplicates, setFoldDuplicates] = useState(false)
  const foldDuplicatesRef = useRef(false)
  const [foldDialog, setFoldDialog] = useState<{ nodeIDs: number[]; items: MediaItem[]; loading: boolean; error: string } | null>(null)
  const foldDialogRequest = useRef(0)
  const [recentSearches, setRecentSearches] = useState(
    () => xDriveGalleryRecentSearches(preferenceScope),
  )
  const [searchOrder, setSearchOrder] = useState('')
  useEffect(() => {
    setRecentSearches(xDriveGalleryRecentSearches(preferenceScope))
  }, [preferenceScope])
  const [gallerySort, setGallerySort] = useState<{
    by: 'captured' | 'added'
    dir: 'asc' | 'desc'
  }>(() => {
    if (typeof window === 'undefined') return { by: 'captured', dir: 'desc' }
    try {
      const stored = JSON.parse(window.localStorage.getItem('xdrive.gallery.sort.v1') || '{}')
      return {
        by: stored.by === 'added' ? 'added' : 'captured',
        dir: stored.dir === 'asc' ? 'asc' : 'desc',
      }
    } catch {
      return { by: 'captured', dir: 'desc' }
    }
  })
  const gallerySortRef = useRef(gallerySort)
  const [mediaTimeZone, setMediaTimeZone] = useState(xDriveReadMediaTimeZone)
  const mediaTimeZoneRef = useRef(mediaTimeZone)
  const pendingSortAnchorRef = useRef(0)
  const [sortAnchorRestoration, setSortAnchorRestoration] =
    useState<{ index: number; requestID: number } | null>(null)
  useEffect(() => {
    try { window.localStorage.setItem('xdrive.gallery.sort.v1', JSON.stringify(gallerySort)) } catch {
      // Browsing works without persisted preferences.
    }
  }, [gallerySort])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collectionError, setCollectionError] = useState('')
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
    signal?: AbortSignal,
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
        return source.listMemoryItemRange(
          target.id, limit, offset, target.query.time_zone ?? mediaTimeZoneRef.current,
        )
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
        return source.listItemRange(limit, offset, target.query, signal)
    }
  }, [source])

  const loadVirtualRange = useCallback(async (
    range: { offset: number; limit: number },
    signal: AbortSignal,
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
    const page = await loadTargetRange(target, range.offset, range.limit, signal)
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
    const anchorNodeID = pendingSortAnchorRef.current
    pendingSortAnchorRef.current = 0
    setSortAnchorRestoration(null)
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
          ? { kind: 'memory', id: memory.id, query: { time_zone: mediaTimeZoneRef.current }, requestID: request }
          : pet
            ? { kind: 'pet', id: pet.id, query: {}, requestID: request }
            : mediaGalleryTarget(
          request,
          album,
          {
            ...nextQuery,
            fold_duplicates: foldDuplicatesRef.current && !nextQuery.fold_member_ids?.length,
            time_zone: mediaTimeZoneRef.current,
            sort_by: gallerySortRef.current.by,
            sort_dir: gallerySortRef.current.dir,
            ...(anchorNodeID > 0 ? { anchor_node_id: anchorNodeID } : {}),
          },
          suggestedPerson,
          person,
        )
    collectionTargetRef.current = target
    setCollectionTarget(target)
    setTimelineGroupSets(emptyMediaTimelineGroupSets())
    setSearchOrder('')
    virtualCollection.reset(mediaGalleryCollectionKey(target))
    setLoading(true)
    setError('')
    setCollectionError('')
    try {
      const rangePromise = loadTargetRange(target, 0, pageSize)
      if (target.kind === 'all' && !target.query.folder_id) {
        setPlacesStatus('loading')
        const facetsPromise = Promise.all([
          source.listAlbums(),
          source.listPlaces
            ? source.listPlaces(placesExpandedRef.current ? 1000 : 24)
            : Promise.resolve([]),
          source.listPets ? source.listPets() : Promise.resolve([]),
          source.listSuggestedPeople
            ? source.listSuggestedPeople(true, 100)
            : Promise.resolve([]),
          listAllPeople(),
        ]).then(
          (values) => ({ values, error: null as unknown }),
          (error: unknown) => ({ values: null, error }),
        )

        const range = await rangePromise
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
        setItems([...range.items])
        setSearchOrder(range.search_order ?? '')
        if (target.query.search?.trim()) {
          setRecentSearches(xDriveGalleryRememberSearch(preferenceScope, target.query.search))
        }
        setTimelineGroupSets(mediaTimelineGroupSetsFromRange(range))
        setSortAnchorRestoration(typeof range.anchor_index === 'number'
          ? { index: range.anchor_index, requestID: request }
          : null)
        virtualCollection.primePage({
          items: range.items,
          totalCount: range.total_count,
          offset: range.offset,
          limit: range.limit,
        })

        void facetsPromise.then((result) => {
          if (
            request !== requestID.current ||
            collectionTargetRef.current?.requestID !== request
          ) return
          if (result.error) {
            setPlacesStatus('error')
            reportError(result.error)
            return
          }
          if (!result.values) return
          const [
            nextAlbums,
            nextPlaces,
            nextPets,
            nextSuggestedPeople,
            nextPeople,
          ] = result.values
          setAlbums(nextAlbums)
          setPlaces(nextPlaces)
          setPlacesStatus('ready')
          setPets(nextPets)
          setSuggestedPeople(
            nextSuggestedPeople.filter((item) => item.review_state !== 'accepted'),
          )
          setPersonIdentities(nextPeople)
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
      setSearchOrder(range.search_order ?? '')
      if (target.query.search?.trim()) {
        setRecentSearches(xDriveGalleryRememberSearch(preferenceScope, target.query.search))
      }
      setTimelineGroupSets(mediaTimelineGroupSetsFromRange(range))
      setSortAnchorRestoration(typeof range.anchor_index === 'number'
        ? { index: range.anchor_index, requestID: request }
        : null)
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
      const message = xDriveMediaGalleryErrorMessage(loadError)
      if (target.kind === 'all' && !target.query.folder_id) setPlacesStatus('error')
      setCollectionError(message)
      onError?.(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [
    listAllPeople,
    loadTargetRange,
    pageSize,
    preferenceScope,
    onError,
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
        xDriveMediaDayKey(new Date(), mediaTimeZoneRef.current),
        48,
        mediaTimeZoneRef.current,
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

  const changeFoldDuplicates = useCallback((enabled: boolean) => {
    foldDuplicatesRef.current = enabled
    setFoldDuplicates(enabled)
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
  }, [
    currentAlbum, currentCleanupReview, currentMemory, currentPerson,
    currentPet, currentSuggestedPerson, loadFirstPage, query, section,
  ])

  const closeFoldDialog = useCallback(() => {
    foldDialogRequest.current += 1
    setFoldDialog(null)
  }, [])

  const openFoldDialog = useCallback((item: MediaItem) => {
    const nodeIDs = item.fold_member_ids ?? []
    if (nodeIDs.length < 2 || nodeIDs.length > 512) return
    const request = ++foldDialogRequest.current
    setFoldDialog({ nodeIDs, items: [], loading: true, error: '' })
    // The Server caps a media range at 500 rows. The verifier can approve
    // up to 512 copies; load the final 12 on a second bounded page.
    void (async () => {
      const memberQuery: MediaGalleryQuery = {
        fold_member_ids: nodeIDs,
        sort_by: gallerySortRef.current.by,
        sort_dir: gallerySortRef.current.dir,
      }
      const first = await source.listItemRange(500, 0, memberQuery)
      if (request !== foldDialogRequest.current) return
      if (first.total_count > nodeIDs.length || first.total_count > 512) {
        throw new Error('副本集合已发生变化，请刷新图库')
      }
      let members = first.items
      if (first.total_count > members.length) {
        const last = await source.listItemRange(500, members.length, memberQuery)
        if (request !== foldDialogRequest.current) return
        if (last.total_count !== first.total_count) {
          throw new Error('副本集合加载期间发生变化，请刷新图库')
        }
        members = [...members, ...last.items]
      }
      if (members.length !== first.total_count) {
        throw new Error('副本集合未完整加载，请刷新图库后重试')
      }
      setFoldDialog({ nodeIDs, items: members, loading: false, error: '' })
    })().catch((error) => {
      if (request !== foldDialogRequest.current) return
      setFoldDialog({ nodeIDs, items: [], loading: false, error: xDriveMediaGalleryErrorMessage(error) })
    })
  }, [source])

  const openFoldMember = useCallback((item: MediaItem, index: number) => {
    if (!foldDialog) return
    const nodeIDs = foldDialog.nodeIDs
    const totalCount = foldDialog.items.length
    closeFoldDialog()
    if (onOpenViewer) {
      onOpenViewer(item, {
        target: {
          kind: 'all',
          query: {
            fold_member_ids: nodeIDs,
            sort_by: gallerySortRef.current.by,
            sort_dir: gallerySortRef.current.dir,
          },
        },
        activeIndex: index,
        totalCount,
      })
    } else {
      // Standalone Gallery uses the normal Viewer in an explicitly scoped range.
      void loadFirstPage(null, { fold_member_ids: nodeIDs })
    }
  }, [closeFoldDialog, foldDialog, loadFirstPage, onOpenViewer])

  const loadCleanup = useCallback(async () => {
    if (!source.listBurstReviews) {
      setBurstReviews(emptyMediaBurstReviewList())
      setError('当前客户端不支持图库清理建议')
      return
    }
    const request = ++requestID.current
    cleanupMoreInFlightRef.current = false
    setCleanupMoreLoading(null)
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
      const nextBursts = await source.listBurstReviews(48, 0)
      if (request !== requestID.current) return
      setBurstReviews(nextBursts)
    } catch (loadError) {
      if (request !== requestID.current) return
      reportError(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [reportError, source, virtualCollection.reset])

  const loadMoreCleanupGroups = useCallback(async () => {
    if (cleanupMoreInFlightRef.current) return
    const current = burstReviews
    const list = source.listBurstReviews
    if (!current || !list || current.groups.length >= current.total_groups) return
    const offset = current.groups.length
    const generation = requestID.current
    cleanupMoreInFlightRef.current = true
    setCleanupMoreLoading('burst')
    try {
      const next = await source.listBurstReviews!(48, offset)
      if (generation !== requestID.current) return

      // Older Servers/Agents ignore offset. Never loop over their first page.
      if (next.offset !== offset) {
        throw new Error('当前服务端或 Agent 不支持清理组分页，请升级后重试')
      }
      const known = new Set(current.groups.map((group) => group.id))
      if (next.total_groups !== current.total_groups ||
          next.groups.length === 0 ||
          next.groups.some((group) => known.has(group.id))) {
        // Imports/deletes may have reordered groups between pages. Restart from
        // the first group rather than silently skipping or duplicating results.
        await loadCleanup()
        return
      }
      setBurstReviews({
        ...next,
        groups: [...current.groups, ...next.groups],
      })
    } catch (pageError) {
      if (generation === requestID.current) {
        reportError(pageError)
      }
    } finally {
      if (generation === requestID.current) {
        cleanupMoreInFlightRef.current = false
        setCleanupMoreLoading(null)
      }
    }
  }, [burstReviews, loadCleanup, reportError, source])

  const loadSyncFolders = useCallback(async () => {
    if (!source.listSyncFolders) {
      setSyncFolders([])
      return
    }
    const request = ++syncFolderRequestID.current
    setSyncFoldersLoading(true)
    setSyncFoldersError('')
    try {
      const next = await source.listSyncFolders()
      if (request !== syncFolderRequestID.current) return
      setSyncFolders(next)
    } catch (loadError) {
      if (request !== syncFolderRequestID.current) return
      setSyncFoldersError(xDriveMediaGalleryErrorMessage(loadError))
      onError?.(loadError)
    } finally {
      if (request === syncFolderRequestID.current) setSyncFoldersLoading(false)
    }
  }, [onError, source])

  const openSyncFolderDirectory = useCallback(async (
    sourceID: number,
    folderID: number,
    resetFilters = false,
  ) => {
    if (!source.getSyncFolder) {
      setError('当前客户端不支持同步文件夹图库')
      return
    }
    const request = ++syncFolderRequestID.current
    setSyncFoldersLoading(true)
    setSyncFoldersError('')
    try {
      const view = await source.getSyncFolder(sourceID, folderID)
      if (request !== syncFolderRequestID.current) return
      const nextDraft = resetFilters ? emptyMediaGalleryFilterDraft : draftFilters
      const nextQuery: MediaGalleryQuery = {
        ...mediaGalleryQueryFromDraft(nextDraft),
        folder_id: view.current.id,
        ...(resetFilters ? {} : { include_descendants: query.include_descendants }),
      }
      setCurrentFolderView(view)
      setCurrentAlbum(null)
      setCurrentSuggestedPerson(null)
      setCurrentPerson(null)
      setCurrentPet(null)
      setCurrentMemory(null)
      setCurrentCleanupReview(null)
      setSection('albums')
      setActiveMediaType('')
      setDraftFilters(nextDraft)
      setQuery(nextQuery)
      await loadFirstPage(null, nextQuery)
    } catch (loadError) {
      if (request !== syncFolderRequestID.current) return
      setSyncFoldersError(xDriveMediaGalleryErrorMessage(loadError))
      onError?.(loadError)
    } finally {
      if (request === syncFolderRequestID.current) setSyncFoldersLoading(false)
    }
  }, [draftFilters, loadFirstPage, onError, query.include_descendants, source])

  const selectSection = useCallback((nextSection: MediaGallerySection) => {
    onSectionRouteChange?.(nextSection)
    syncFolderRequestID.current += 1
    setCurrentFolderView(null)
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
    if (nextSection === 'albums') void loadSyncFolders()
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
  }, [loadCleanup, loadFirstPage, loadMemories, loadSyncFolders, onSectionRouteChange])

  const requestIndexStatus = useCallback(async () => {
    if (!source.getIndexStatus) return
    const request = ++indexRequestID.current
    setIndexStatusLoading(true)
    setIndexStatusError('')
    try {
      const status = await source.getIndexStatus()
      if (request === indexRequestID.current) setIndexStatus(status)
    } catch (error) {
      if (request !== indexRequestID.current) return
      setIndexStatusError(xDriveMediaGalleryErrorMessage(error))
      onError?.(error)
    } finally {
      if (request === indexRequestID.current) setIndexStatusLoading(false)
    }
  }, [onError, source])

  const requestFacets = useCallback(async (
    nextDraft: MediaGalleryFilterDraft = draftFilters,
  ) => {
    if (!source.listFacets || currentSuggestedPerson || currentPet || currentMemory || currentCleanupReview) return
    const request = ++facetRequestID.current
    setFacetsLoading(true)
    setFacetsError('')
    setFacets({ cameras: [], formats: [] })
    try {
      const facetQuery: MediaGalleryQuery = {
        ...mediaGalleryQueryFromDraft(nextDraft),
        ...(currentFolderView ? { folder_id: currentFolderView.current.id, include_descendants: query.include_descendants } : {}),
      }
      const albumID = currentAlbum && currentAlbum.kind !== 'smart' ? currentAlbum.id : undefined
      const nextFacets = await source.listFacets(facetQuery, albumID)
      if (request !== facetRequestID.current) return
      setFacets(nextFacets)
    } catch (facetError) {
      if (request !== facetRequestID.current) return
      setFacetsError(xDriveMediaGalleryErrorMessage(facetError))
      onError?.(facetError)
    } finally {
      if (request === facetRequestID.current) setFacetsLoading(false)
    }
  }, [currentAlbum, currentCleanupReview, currentFolderView, currentMemory, currentPet, currentSuggestedPerson, draftFilters, onError, query.include_descendants, source])

  const applyFilters = useCallback(() => {
    const nextQuery: MediaGalleryQuery = {
      ...mediaGalleryQueryFromDraft(draftFilters),
      ...(currentFolderView ? { folder_id: currentFolderView.current.id, include_descendants: query.include_descendants } : {}),
    }
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
    currentFolderView,
    currentPerson,
    currentSuggestedPerson,
    draftFilters,
    loadFirstPage,
    onError,
    replaceAlbum,
    query.include_descendants,
    source,
  ])

  const changeGallerySort = useCallback((
    by: 'captured' | 'added',
    dir: 'asc' | 'desc',
    anchorNodeID?: number,
  ) => {
    if (gallerySortRef.current.by === by && gallerySortRef.current.dir === dir) return
    const next = { by, dir }
    pendingSortAnchorRef.current = Number.isSafeInteger(anchorNodeID) && (anchorNodeID ?? 0) > 0
      ? anchorNodeID!
      : 0
    gallerySortRef.current = next
    setGallerySort(next)
    // A new server range order owns a new sparse-collection generation.
    void loadFirstPage(currentAlbum, query, currentSuggestedPerson, currentPerson)
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage, query])

  const changeGalleryTimeZone = useCallback((nextZone: string) => {
    if (!xDriveValidMediaTimeZone(nextZone) || mediaTimeZoneRef.current === nextZone) return
    // Update the preference before recomputing capture-date boundaries.
    xDriveWriteMediaTimeZone(nextZone)
    mediaTimeZoneRef.current = nextZone
    setMediaTimeZone(nextZone)
    if (section === 'memories') {
      void loadMemories()
      return
    }
    const nextQuery: MediaGalleryQuery = {
      ...mediaGalleryQueryFromDraft(draftFilters),
      ...(currentFolderView ? { folder_id: currentFolderView.current.id, include_descendants: query.include_descendants } : {}),
    }
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [
    currentAlbum, currentFolderView, currentPerson, currentSuggestedPerson,
    draftFilters, loadFirstPage, loadMemories, query.include_descendants, section,
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
    const nextQuery: MediaGalleryQuery = {
      ...mediaGalleryQueryFromDraft(nextDraft),
      ...(currentFolderView ? { folder_id: currentFolderView.current.id, include_descendants: query.include_descendants } : {}),
    }
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [
    activeMediaType,
    currentAlbum,
    currentFolderView,
    currentPerson,
    currentSuggestedPerson,
    loadFirstPage,
    query.include_descendants,
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

  const setAlbumCover = useCallback(async (album: MediaAlbum, item?: MediaItem) => {
    if (!source.setAlbumCover || !album.revision) throw new Error('当前客户端不支持设置相册封面')
    try {
      const updated = await source.setAlbumCover(album.id, album.revision, item?.node.id ?? 0)
      replaceAlbum(updated)
      return updated
    } catch (error) {
      setError(xDriveMediaGalleryErrorMessage(error))
      onError?.(error)
      throw error
    }
  }, [onError, replaceAlbum, source])

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
    syncFolderRequestID.current += 1
    setCurrentFolderView(null)
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
    if (currentFolderView) {
      const breadcrumbs = currentFolderView.breadcrumbs
      if (breadcrumbs.length > 1) {
        const parent = breadcrumbs[breadcrumbs.length - 2]
        void openSyncFolderDirectory(currentFolderView.source.source_id, parent.id)
        return
      }
      setCurrentFolderView(null)
      selectSection('albums')
      return
    }
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
    currentFolderView,
    currentMemory,
    currentPet,
    loadCleanup,
    loadFirstPage,
    loadMemories,
    openSyncFolderDirectory,
    section,
    selectSection,
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

  const exportLivePhoto = useCallback(async (item: MediaItem) => {
    if (!source.exportLivePhoto) return
    setError('')
    try {
      await source.exportLivePhoto(item)
    } catch (exportError) {
      setError(xDriveMediaGalleryErrorMessage(exportError))
      onError?.(exportError)
      throw exportError
    }
  }, [onError, source])

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
    facetRequestID.current += 1
    syncFolderRequestID.current += 1
  }, [])

  // Search feedback must describe the last accepted Server query, not edits still
  // sitting in the filter popover. Saved smart-album rules are separately scoped.
  const appliedFilterQuery = currentAlbum?.kind === 'smart'
    ? currentAlbum.query ?? {}
    : query
  const draftPending = xDriveGalleryFilterSignature(
    mediaGalleryQueryFromDraft(draftFilters),
  ) !== xDriveGalleryFilterSignature(appliedFilterQuery)

  const removeAppliedFilter = useCallback((key: XDriveGalleryAppliedFilterKey) => {
    if (currentAlbum?.kind === 'smart') return
    const nextApplied: MediaGalleryQuery = { ...query }
    delete nextApplied[key]
    const nextDraft = mediaGalleryDraftFromQuery(nextApplied)
    const nextQuery: MediaGalleryQuery = {
      ...mediaGalleryQueryFromDraft(nextDraft),
      ...(currentFolderView ? { folder_id: currentFolderView.current.id, include_descendants: query.include_descendants } : {}),
    }
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [currentAlbum, currentFolderView, currentPerson, currentSuggestedPerson, loadFirstPage, query])

  const refreshGallery = () => {
    if (currentFolderView) {
      void openSyncFolderDirectory(
        currentFolderView.source.source_id,
        currentFolderView.current.id,
      )
      return
    }
    if (section === 'albums' && !currentFolderView) {
      void loadSyncFolders()
    }
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
  }

  const appliedScopeLabel = currentFolderView
    ? '同步文件夹：' + currentFolderView.source.source_name +
      ' · ' + currentFolderView.current.path +
      (query.include_descendants ? '（包含子目录）' : '（仅当前目录）')
    : undefined

  return (
    <XDriveWorkspaceSurface presentation="page" title="图库" showPageHeader={false}>
      <XDriveMediaGallery
        key={preferenceScope || 'gallery-default'}
        preferenceScope={preferenceScope}
        items={items}
        virtualCollection={galleryVirtualCollection}
        collectionKey={mediaGalleryCollectionKey(collectionTarget)}
        albums={albums}
        albumFolderActions={source.listAlbumFolders ? {
          list: source.listAlbumFolders,
          create: source.createAlbumFolder,
          update: source.updateAlbumFolder,
          remove: source.deleteAlbumFolder,
          moveAlbum: source.moveAlbumToFolder,
          onAlbumMoved: (updated) => setAlbums((current) => (
            current.map((album) => album.id === updated.id ? updated : album)
          )),
        } : undefined}
        syncFolders={syncFolders}
        currentFolderView={currentFolderView}
        includeDescendants={Boolean(query.include_descendants)}
        onIncludeDescendantsChange={currentFolderView ? (enabled) => {
          const nextQuery: MediaGalleryQuery = {
            ...query,
            folder_id: currentFolderView.current.id,
            include_descendants: enabled || undefined,
          }
          setQuery(nextQuery)
          void loadFirstPage(null, nextQuery)
        } : undefined}
        syncFoldersLoading={syncFoldersLoading}
        syncFoldersError={syncFoldersError}
        places={places}
        placesStatus={placesStatus}
        memories={memories}
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
        collectionError={collectionError}
        section={section}
        activeMediaType={activeMediaType}
        searchActive={Boolean(appliedFilterQuery.search?.trim())}
        appliedQuery={appliedFilterQuery}
        appliedScopeLabel={appliedScopeLabel}
        draftPending={draftPending}
        searchOrder={searchOrder}
        indexStatus={indexStatus}
        indexStatusLoading={indexStatusLoading}
        indexStatusError={indexStatusError}
        onRequestIndexStatus={source.getIndexStatus ? requestIndexStatus : undefined}
        onRemoveAppliedFilter={
          currentAlbum?.kind === 'smart' ? undefined : removeAppliedFilter
        }
        foldDuplicates={foldDuplicates}
        onToggleFoldDuplicates={changeFoldDuplicates}
        onExpandFold={openFoldDialog}
        sortBy={gallerySort.by}
        sortDir={gallerySort.dir}
        timeZone={mediaTimeZone}
        onTimeZoneChange={changeGalleryTimeZone}
        onSortChange={changeGallerySort}
        sortAnchorIndex={sortAnchorRestoration?.index}
        sortAnchorRevision={sortAnchorRestoration?.requestID}
        filtersActive={xDriveGalleryAppliedChips(appliedFilterQuery).length > 0}
        onClearFilters={clearFilters}
        filters={(
          <XDriveMediaGalleryFilterToolbar
            draft={draftFilters}
            recentSearches={recentSearches}
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
            facets={facets}
            facetsLoading={facetsLoading}
            facetsError={facetsError}
            facetsAvailable={Boolean(source.listFacets) && !currentSuggestedPerson}
            onRequestFacets={requestFacets}
            onChange={setDraftFilters}
            onApply={applyFilters}
            onClear={clearFilters}
            onSaveSmart={
              !currentAlbum && !currentFolderView && !currentSuggestedPerson && source.createSmartAlbum
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
        loadNodeLocation={source.getNodeLocation}
        onShowInFolder={onShowInFolder}
        loadMusicRoot={source.loadMusicRoot}
        listMusicChildren={source.listMusicChildren}
        loadLivePhotoMotion={source.loadLivePhotoMotion}
        loadPreviewURL={source.loadPreviewURL}
        saveVideoPoster={source.saveVideoPoster}
        onSetFavorite={source.setFavorite ? setFavorite : undefined}
        onSetFavoriteBatch={source.setFavoriteBatch ? setFavoriteBatch : undefined}
        onAddTagsBatch={source.addTagsBatch ? addTagsBatch : undefined}
        onAddItemsToAlbum={source.addToAlbum ? addItemsToAlbum : undefined}
        onDeleteItems={source.deleteItems ? deleteItems : undefined}
        onDownloadItems={source.downloadItems ? downloadItems : undefined}
        onExportLivePhoto={source.exportLivePhoto ? exportLivePhoto : undefined}
        onShareItem={shareDialog ? setShareItem : undefined}
        onOpenViewer={onOpenViewer ? (item, activeIndex) => {
          const target = collectionTargetRef.current
          if (!target) return
          const { requestID: _requestID, ...serializableTarget } = target
          const { anchor_node_id: _anchor, ...viewerQuery } = serializableTarget.query
          onOpenViewer(item, {
            target: { ...serializableTarget, query: viewerQuery },
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
        onSetAlbumCover={source.setAlbumCover ? setAlbumCover : undefined}
        onAddToAlbum={source.addToAlbum ? addToAlbum : undefined}
        onRemoveFromAlbum={source.removeFromAlbum ? removeFromAlbum : undefined}
        onSectionChange={selectSection}
        onOpenMediaType={openMediaType}
        onOpenAlbum={openAlbum}
        onOpenSyncFolder={source.getSyncFolder
          ? (folder) => {
              void openSyncFolderDirectory(folder.source_id, folder.target_node_id, true)
            }
          : undefined}
        onOpenFolder={source.getSyncFolder && currentFolderView
          ? (folder) => {
              void openSyncFolderDirectory(currentFolderView.source.source_id, folder.id)
            }
          : undefined}
        onOpenFolderBreadcrumb={source.getSyncFolder && currentFolderView
          ? (breadcrumb) => {
              void openSyncFolderDirectory(currentFolderView.source.source_id, breadcrumb.id)
            }
          : undefined}
        onOpenPlace={openPlace}
        onOpenMemory={openMemory}
        onOpenBurstReview={openBurstReview}
        onLoadMoreBurst={() => void loadMoreCleanupGroups()}
        cleanupMoreLoading={cleanupMoreLoading}
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
        onRefresh={refreshGallery}
      />
      <Dialog
        open={Boolean(foldDialog)}
        onClose={closeFoldDialog}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
        data-xdrive-gallery-verified-fold-dialog
      >
        <XDriveDialogTitle
          title={`相同内容的 ${foldDialog?.nodeIDs.length ?? 0} 份文件`}
          subtitle="原文件、所在目录、相册和个人信息均保持独立。"
          onClose={closeFoldDialog}
        />
        <XDriveDialogContent dividers>
          {foldDialog?.loading ? (
            <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={26} /></Stack>
          ) : foldDialog?.error ? (
            <XDriveStatusAlert tone="bad">{foldDialog.error}</XDriveStatusAlert>
          ) : foldDialog?.items.length ? (
            <Stack spacing={1}>
              {foldDialog.items.map((member, index) => (
                <Button
                  key={member.node.id}
                  variant="text"
                  onClick={() => openFoldMember(member, index)}
                  sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                    gap: 1.5, minHeight: 64, textTransform: 'none', textAlign: 'left',
                    color: 'text.primary',
                  }}
                  data-xdrive-gallery-verified-fold-member={member.node.id}
                >
                  <Box sx={{ width: 56, height: 56, flexShrink: 0, overflow: 'hidden' }}>
                    <XDriveMediaAsyncThumbnail
                      nodeID={member.metadata.has_thumbnail ? member.node.id : undefined}
                      alt={member.node.name}
                      loadThumbnail={source.loadThumbnail}
                      fallback={xDriveMediaFallback(member.metadata.media_kind)}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{member.node.name}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {[
                        `文件 #${member.node.id}`,
                        member.favorite ? '已收藏' : '',
                        member.tags?.length ? `标签 ${member.tags.join('、')}` : '',
                        member.people?.length ? `人物 ${member.people.join('、')}` : '',
                      ].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                </Button>
              ))}
              <XDriveMediaGalleryDuplicateOrganizePreview
                nodeIDs={foldDialog.nodeIDs}
                items={foldDialog.items}
                requestPlan={source.getDuplicateOrganizePlan}
                applyPlan={source.applyDuplicateOrganize}
                onRefresh={refreshGallery}
              />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              这些副本可能已被移动或删除，请返回图库刷新。
            </Typography>
          )}
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={closeFoldDialog}>关闭</Button>
        </DialogActions>
      </Dialog>
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
  loadNodeLocation?: (nodeID: number, signal?: AbortSignal) => Promise<NodeLocation>
  onShowInFolder?: (location: NodeLocation) => void
  preferenceScope?: string
  items: MediaItem[]
  virtualCollection?: XDriveMediaGalleryVirtualCollection
  collectionKey?: string
  albums?: MediaAlbum[]
  albumFolderActions?: XDriveMediaGalleryAlbumFolderActions
  syncFolders?: MediaSyncFolder[]
  currentFolderView?: MediaFolderView | null
  includeDescendants?: boolean
  onIncludeDescendantsChange?: (enabled: boolean) => void
  syncFoldersLoading?: boolean
  syncFoldersError?: string
  places?: MediaPlaceFacet[]
  placesStatus?: 'loading' | 'ready' | 'error'
  memories?: MediaMemory[]
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
  collectionError?: string
  section?: MediaGallerySection
  activeMediaType?: string
  searchActive?: boolean
  appliedQuery?: MediaGalleryQuery
  appliedScopeLabel?: string
  draftPending?: boolean
  searchOrder?: string
  foldDuplicates?: boolean
  onToggleFoldDuplicates?: (enabled: boolean) => void
  onExpandFold?: (item: MediaItem) => void
  indexStatus?: MediaGalleryIndexStatus | null
  indexStatusLoading?: boolean
  indexStatusError?: string
  onRequestIndexStatus?: () => void
  onRemoveAppliedFilter?: (key: XDriveGalleryAppliedFilterKey) => void
  sortBy?: 'captured' | 'added'
  sortDir?: 'asc' | 'desc'
  timeZone?: string
  onTimeZoneChange?: (zone: string) => void
  onSortChange?: (
    by: 'captured' | 'added',
    dir: 'asc' | 'desc',
    anchorNodeID?: number,
  ) => void
  sortAnchorIndex?: number
  sortAnchorRevision?: number
  filtersActive?: boolean
  onClearFilters?: () => void
  filters?: ReactNode
  loadThumbnail: MediaThumbnailLoader
  loadMusicRoot?: () => Promise<Node>
  listMusicChildren?: (parentID: number) => Promise<Node[]>
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetFavoriteBatch?: (items: MediaItem[], favorite: boolean) => Promise<void>
  onAddTagsBatch?: (items: MediaItem[], tags: string[]) => Promise<void>
  onAddItemsToAlbum?: (album: MediaAlbum, items: MediaItem[]) => Promise<void>
  onDeleteItems?: (items: MediaItem[]) => Promise<void>
  onDownloadItems?: (items: MediaItem[]) => Promise<void>
  onExportLivePhoto?: (item: MediaItem) => Promise<void>
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
  onSetAlbumCover?: (album: MediaAlbum, item?: MediaItem) => Promise<MediaAlbum>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onSectionChange?: (section: MediaGallerySection) => void
  onOpenMediaType?: (assetKind: string) => void
  onOpenAlbum?: (album: MediaAlbum) => void
  onOpenSyncFolder?: (folder: MediaSyncFolder) => void
  onOpenFolder?: (folder: MediaFolderEntry) => void
  onOpenFolderBreadcrumb?: (breadcrumb: MediaFolderBreadcrumb) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenMemory?: (memory: MediaMemory) => void
  onOpenBurstReview?: (group: MediaBurstReview) => void
  onLoadMoreBurst?: () => void
  cleanupMoreLoading?: 'burst' | null
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
      return null
  }
}

type MediaGalleryTimeScale = 'year' | 'month' | 'day' | 'all'

type MediaGalleryDensityPreferences = Record<MediaGalleryTimeScale, number>

type MediaGalleryAspectMode = 'crop' | 'contain'

type MediaGalleryViewPreferences = {
  timeScale: MediaGalleryTimeScale
  densityByScale: MediaGalleryDensityPreferences
  aspectMode: MediaGalleryAspectMode
}

const XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY = 'xdrive.gallery.view-preferences.v1'
const XDRIVE_MEDIA_GALLERY_DEFAULT_DENSITY: MediaGalleryDensityPreferences = {
  year: 96,
  month: 144,
  day: 192,
  all: 144,
}
const XDRIVE_MEDIA_GALLERY_DENSITY_MIN = 96
const XDRIVE_MEDIA_GALLERY_DENSITY_MAX = 240
const XDRIVE_MEDIA_GALLERY_DENSITY_STEP = 24
const mediaGalleryTimeScaleValues: readonly MediaGalleryTimeScale[] = [
  'year',
  'month',
  'day',
  'all',
]

function mediaGalleryNormalizeDensity(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const snapped = XDRIVE_MEDIA_GALLERY_DENSITY_MIN +
    Math.round(
      (value - XDRIVE_MEDIA_GALLERY_DENSITY_MIN) /
      XDRIVE_MEDIA_GALLERY_DENSITY_STEP,
    ) * XDRIVE_MEDIA_GALLERY_DENSITY_STEP
  return Math.max(
    XDRIVE_MEDIA_GALLERY_DENSITY_MIN,
    Math.min(XDRIVE_MEDIA_GALLERY_DENSITY_MAX, snapped),
  )
}

function xDriveReadMediaGalleryViewPreferences(): MediaGalleryViewPreferences {
  const fallback: MediaGalleryViewPreferences = {
    timeScale: 'all',
    densityByScale: { ...XDRIVE_MEDIA_GALLERY_DEFAULT_DENSITY },
    aspectMode: 'crop',
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<MediaGalleryViewPreferences>
    const timeScale = mediaGalleryTimeScaleValues.includes(
      parsed.timeScale as MediaGalleryTimeScale,
    )
      ? parsed.timeScale as MediaGalleryTimeScale
      : fallback.timeScale
    const densityByScale = { ...fallback.densityByScale }
    for (const scale of mediaGalleryTimeScaleValues) {
      densityByScale[scale] = mediaGalleryNormalizeDensity(
        parsed.densityByScale?.[scale],
        densityByScale[scale],
      )
    }
    const aspectMode: MediaGalleryAspectMode =
      parsed.aspectMode === 'contain' ? 'contain' : 'crop'
    return { timeScale, densityByScale, aspectMode }
  } catch {
    return fallback
  }
}

function xDriveWriteMediaGalleryViewPreferences(
  preferences: MediaGalleryViewPreferences,
) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY,
      JSON.stringify(preferences),
    )
  } catch {
    // Browsing remains functional when storage is disabled or unavailable.
  }
}

function scrollMediaGalleryHostToOffset(host: HTMLElement, offset: number) {
  const scrollParent = mediaGalleryScrollParent(host)
  const hostRect = host.getBoundingClientRect()
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect()
    scrollParent.scrollTop += hostRect.top - parentRect.top + Math.max(0, offset)
    return
  }
  window.scrollBy({ top: hostRect.top + Math.max(0, offset), behavior: 'auto' })
}

function mediaGalleryTimelineOffsetForIndex(
  layout: ReturnType<typeof xDriveMediaGalleryTimelineLayout>,
  logicalIndex: number,
) {
  const index = Math.max(0, Math.trunc(logicalIndex))
  const group = layout.groups.find((candidate) => (
    index >= candidate.startIndex &&
    index < candidate.startIndex + candidate.itemCount
  ))
  if (!group) return null
  const row = Math.floor((index - group.startIndex) / Math.max(1, layout.columns))
  return group.itemsTop + row * layout.rowStep
}

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

function mediaTimelineDate(item: MediaItem, sortBy: 'captured' | 'added') {
  const raw = sortBy === 'added' ? item.node.created_at : item.metadata.captured_at
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function mediaTimelineGroups(
  items: MediaItem[],
  scale: Exclude<MediaGalleryTimeScale, 'all'>,
  sortBy: 'captured' | 'added' = 'captured',
  sortDir: 'asc' | 'desc' = 'desc',
  timeZone = 'UTC',
): MediaTimelineGroup[] {
  const groups = new Map<string, MediaTimelineGroup>()
  const unknown: MediaItem[] = []
  for (const item of items) {
    const date = mediaTimelineDate(item, sortBy)
    if (!date) {
      unknown.push(item)
      continue
    }
    const localDay = xDriveMediaDayKey(date, timeZone)
    const year = localDay.slice(0, 4)
    const month = localDay.slice(5, 7)
    const day = localDay.slice(8, 10)
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
      label: new Intl.DateTimeFormat('zh-CN', { ...formatOptions, timeZone }).format(date),
      items: [item],
      startIndex: 0,
    })
  }
  const ordered = Array.from(groups.values()).sort((a, b) => (
    sortDir === 'asc' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)
  ))
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
  saveVideoPoster?: MediaVideoPosterSaver
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
  saveVideoPoster,
  onSetFavorite,
  onSetCover,
  onPreview,
  onToggleFavorite,
}: MediaTileProps) {
  const video = item.metadata.media_kind === 'video'
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  const mediaBadgeLabel = mediaAssetChipLabel(item)
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const openPreview = () => onPreview(item)

  const effectiveThumbnailLoader = useCallback(
    (nodeID: number, signal?: AbortSignal) => thumbnailScheduler
      ? thumbnailScheduler.load(nodeID, thumbnailPriority, item.node.revision)
      : loadThumbnail(nodeID, signal, item.node.revision),
    [loadThumbnail, thumbnailPriority, thumbnailScheduler, item.node.revision],
  )

  return (
    <Paper
      variant="outlined"
      data-xdrive-media-tile
      data-xdrive-media-index={logicalIndex}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        // First click already opened Viewer; ignore a double-click's second click.
        if (event.detail > 1) return
        openPreview()
      }}
      onDoubleClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === ' ' || (selectionMode && event.key === 'Enter')) {
          event.preventDefault()
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        keyboardActivate(event, () => onPreview(item))
      }}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        bgcolor: 'action.hover',
        border: 0,
        borderRadius: 0,
        boxShadow: 'none',
        outline: selectedForAction ? '2px solid' : 'none',
        outlineColor: selectedForAction ? 'primary.main' : 'transparent',
        outlineOffset: selectedForAction ? -2 : 0,
        '&:hover .media-name, &:focus-visible .media-name, &:focus-within .media-name': {
          opacity: 1,
        },
        '&:hover .media-favorite, &:focus-within .media-favorite': {
          opacity: 1,
          pointerEvents: 'auto',
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 1,
        },
      }}
    >
      {video && !livePhoto && loadPreviewURL ? (
        <XDriveMediaAsyncVideoPoster
          nodeID={item.node.id}
          revision={item.node.revision}
          alt={item.node.name}
          loadPreviewURL={loadPreviewURL}
          loadThumbnail={loadThumbnail}
          saveVideoPoster={saveVideoPoster}
          rotationDegrees={item.metadata.rotation_degrees}
          sourceWidth={item.metadata.width}
          sourceHeight={item.metadata.height}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
        />
      ) : (
        <XDriveMediaAsyncThumbnail
          nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
          revision={item.node.revision}
          alt={item.node.name}
          loadThumbnail={effectiveThumbnailLoader}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
          revokeOnDispose={!thumbnailScheduler}
        />
      )}
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
            p: compactTouch ? 0 : 0.5,
            width: compactTouch ? 44 : undefined,
            height: compactTouch ? 44 : undefined,
            bgcolor: 'rgba(0,0,0,.58)',
            color: '#fff',
            borderRadius: 1,
            '&.Mui-checked': { color: 'primary.light' },
            '&:hover': { bgcolor: 'rgba(0,0,0,.72)' },
          }}
        />
      ) : null}
      {!compactTouch && onSetFavorite ? (
        <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            className="media-favorite"
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
              left: selectionMode || selectedForAction ? (compactTouch ? 52 : 42) : 8,
              width: compactTouch ? 44 : undefined,
              height: compactTouch ? 44 : undefined,
              opacity: compactTouch || item.favorite ? 1 : 0,
              pointerEvents: compactTouch || item.favorite ? 'auto' : 'none',
              transition: 'opacity 120ms ease, background-color 120ms ease',
              bgcolor: 'rgba(0,0,0,.66)',
              color: item.favorite ? 'warning.main' : '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,.78)' },
            }}
          >
            {item.favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {(recommendedForCleanup || mediaBadgeLabel || (item.fold_member_ids?.length ?? 0) > 1 || (item.edit_recipe?.source_current && item.edit_recipe.revision > 0)) ? (
        <Stack
          spacing={0.5}
          alignItems="flex-end"
          data-xdrive-media-tile-badges
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          {(item.fold_member_ids?.length ?? 0) > 1 ? (
            <Chip
              clickable={!compactTouch}
              component={compactTouch ? 'span' : 'button'}
              size="small"
              label={`${item.fold_member_ids!.length} 份`}
              aria-label={`展开 ${item.fold_member_ids!.length} 份完整资源一致的副本`}
              data-xdrive-media-fold-expand={item.node.id}
              onClick={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
              sx={{
                pointerEvents: compactTouch ? 'none' : 'auto', bgcolor: 'rgba(0,0,0,.75)',
                color: '#fff', fontWeight: 700,
              }}
            />
          ) : null}
          {recommendedForCleanup ? (
            <Chip
              size="small"
              label="建议保留"
              data-xdrive-media-cleanup-recommended
              sx={{
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 1,
                fontWeight: 700,
              }}
            />
          ) : null}
          {mediaBadgeLabel ? (
            <Chip
              icon={livePhoto ? <XDriveLivePhotoGlyph size={20} /> : video ? <MovieIcon /> : <ImageIcon />}
              label={mediaBadgeLabel}
              size="small"
              sx={{
                bgcolor: 'rgba(0,0,0,.66)',
                color: '#fff',
                '& .MuiChip-icon': { color: '#fff' },
              }}
            />
          ) : null}
          {item.edit_recipe?.source_current && item.edit_recipe.revision > 0 ? (
            <Chip
              label="已编辑"
              size="small"
              data-xdrive-media-edited
              sx={{
                bgcolor: 'rgba(0,0,0,.66)',
                color: '#fff',
              }}
            />
          ) : null}
        </Stack>
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
          opacity: 0,
          pointerEvents: 'none',
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
  saveVideoPoster,
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
  saveVideoPoster?: MediaVideoPosterSaver
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
        gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
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
          saveVideoPoster={saveVideoPoster}
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
  saveVideoPoster,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedNodeIDs,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
  recommendedNodeID,
  restoreAnchorIndex,
  restoreAnchorRevision = 0,
  onVisibleAnchorChange,
}: {
  collection: XDriveMediaGalleryVirtualCollection
  minTileWidth: number
  selectionMode: boolean
  selectedNodeIDs: ReadonlySet<number>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
  loadPreviewURL?: MediaPreviewURLLoader
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem, index: number) => void
  onToggleFavorite: (item: MediaItem) => void
  recommendedNodeID?: number
  restoreAnchorIndex?: number
  restoreAnchorRevision?: number
  onVisibleAnchorChange?: (index: number) => void
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
        if (visibleWindow.end > visibleWindow.start) {
          onVisibleAnchorChange?.(visibleWindow.start)
        }
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
  }, [collection.itemCount, collection.onRangeChange, minTileWidth, onVisibleAnchorChange])

  useLayoutEffect(() => {
    if (restoreAnchorRevision <= 0 || restoreAnchorIndex === undefined) return
    const host = hostRef.current
    if (!host || collection.itemCount <= 0) return
    const metrics = xDriveMediaGalleryGridMetrics({
      width: host.clientWidth,
      itemCount: collection.itemCount,
      minColumnWidth: minTileWidth,
    })
    const index = Math.max(
      0,
      Math.min(collection.itemCount - 1, Math.trunc(restoreAnchorIndex)),
    )
    const offset = Math.floor(index / Math.max(1, metrics.columns)) * metrics.rowStep
    const frame = window.requestAnimationFrame(() => {
      if (hostRef.current) scrollMediaGalleryHostToOffset(hostRef.current, offset)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    collection.itemCount,
    minTileWidth,
    restoreAnchorIndex,
    restoreAnchorRevision,
  ])

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
          saveVideoPoster={saveVideoPoster}
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
            border: 0,
            borderRadius: 0,
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
  saveVideoPoster,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedNodeIDs,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
  restoreAnchorIndex,
  restoreAnchorRevision = 0,
  onVisibleAnchorChange,
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
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem, index: number) => void
  onToggleFavorite: (item: MediaItem) => void
  restoreAnchorIndex?: number
  restoreAnchorRevision?: number
  onVisibleAnchorChange?: (index: number) => void
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
        if (visibleWindow.endIndex > visibleWindow.startIndex) {
          onVisibleAnchorChange?.(visibleWindow.startIndex)
        } else if (nextWindow.endIndex > nextWindow.startIndex) {
          onVisibleAnchorChange?.(nextWindow.startIndex)
        }
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
  }, [collection.onRangeChange, groups, minTileWidth, onVisibleAnchorChange])

  useLayoutEffect(() => {
    if (restoreAnchorRevision <= 0 || restoreAnchorIndex === undefined) return
    const host = hostRef.current
    if (!host) return
    const layout = xDriveMediaGalleryTimelineLayout({
      width: host.clientWidth,
      groups,
      minColumnWidth: minTileWidth,
    })
    const offset = mediaGalleryTimelineOffsetForIndex(layout, restoreAnchorIndex)
    if (offset === null) return
    const frame = window.requestAnimationFrame(() => {
      if (hostRef.current) scrollMediaGalleryHostToOffset(hostRef.current, offset)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    groups,
    minTileWidth,
    restoreAnchorIndex,
    restoreAnchorRevision,
  ])

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
                saveVideoPoster={saveVideoPoster}
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
                  border: 0,
                  borderRadius: 0,
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
              data-xdrive-gallery-sticky-date
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                height: group.headerHeight,
                mb: `${XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP}px`,
                bgcolor: 'background.paper',
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

const personTouchTargetSx = {
  '@media (max-width:899.95px)': { minWidth: 44, minHeight: 44 },
} as const

const personDialogPaperProps = {
  sx: {
    ...xDriveDialogPaperProps.sx,
    '@media (max-width:899.95px)': {
      '& .MuiDialogTitle-root': {
        flexShrink: 0, minHeight: 60, px: 1.5, py: 1,
        '& .MuiTypography-h6': { fontSize: '1rem' },
        '& .MuiTypography-body2': { display: 'none' },
        '& .MuiIconButton-root': { width: 44, height: 44, mt: 0, mr: 0 },
      },
      '& .MuiDialogContent-root': { overflowY: 'visible' },
      '& .MuiButton-root, & .MuiFormControlLabel-root': { minWidth: 44, minHeight: 44 },
    },
  },
} as const

// On short compact screens, only the title/Close stay fixed. Description,
// fields, choices, errors and actions share one bounded scroll region.
const personDialogScrollSx = {
  display: 'contents',
  '@media (max-width:899.95px)': {
    display: 'block', flex: '1 1 auto', minHeight: 0,
    overflowY: 'auto', overscrollBehavior: 'contain',
  },
} as const

const personDialogDescriptionSx = {
  display: 'none',
  '@media (max-width:899.95px)': { display: 'block', mb: 1.5 },
} as const

const personDialogDescriptions = {
  adopt: '保存后成为长期人物，不再受自动聚类重建影响。',
  rename: '名称可以留空，长期人物身份仍会保留。',
  assign: '把这组自动聚类建议加入一个长期人物；原人物名称与 ID 保留。',
  merge: '选中的人物会合并到当前人物；当前人物 ID 和名称会保留。',
  split: '选择要移动到新人物的照片。至少要给当前人物保留一张照片。',
} as const

export function XDriveMediaGallery({
  preferenceScope = '',
  items,
  virtualCollection,
  collectionKey = '',
  albums = [],
  albumFolderActions,
  syncFolders = [],
  currentFolderView = null,
  includeDescendants = false,
  onIncludeDescendantsChange,
  syncFoldersLoading = false,
  syncFoldersError = '',
  places = [],
  placesStatus = 'ready',
  memories = [],
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
  collectionError = '',
  section = 'library',
  activeMediaType = '',
  searchActive = false,
  appliedQuery = {},
  appliedScopeLabel,
  draftPending = false,
  searchOrder = '',
  foldDuplicates = false,
  onToggleFoldDuplicates,
  onExpandFold,
  indexStatus = null,
  indexStatusLoading = false,
  indexStatusError = '',
  onRequestIndexStatus,
  onRemoveAppliedFilter,
  sortBy = 'captured',
  sortDir = 'desc',
  timeZone = xDriveReadMediaTimeZone(),
  onTimeZoneChange,
  onSortChange,
  sortAnchorIndex,
  sortAnchorRevision = 0,
  filtersActive = false,
  onClearFilters,
  filters,
  loadThumbnail,
  loadNodeLocation,
  onShowInFolder,
  loadMusicRoot,
  listMusicChildren,
  loadLivePhotoMotion,
  loadPreviewURL,
  saveVideoPoster,
  onSetFavorite,
  onSetFavoriteBatch,
  onAddTagsBatch,
  onAddItemsToAlbum,
  onDeleteItems,
  onDownloadItems,
  onExportLivePhoto,
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
  onSetAlbumCover,
  onAddToAlbum,
  onRemoveFromAlbum,
  onSectionChange,
  onOpenMediaType,
  onOpenAlbum,
  onOpenSyncFolder,
  onOpenFolder,
  onOpenFolderBreadcrumb,
  onOpenPlace,
  onOpenMemory,
  onOpenBurstReview,
  onLoadMoreBurst,
  cleanupMoreLoading,
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
  const availableTimeZones = useMemo(xDriveMediaTimeZoneChoices, [])
  useEffect(() => () => {
    thumbnailScheduler.dispose()
  }, [thumbnailScheduler])

  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [mediaContextMenu, setMediaContextMenu] = useState<{ item: MediaItem; index: number; top: number; left: number } | null>(null)
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)
  const [previewLogicalIndex, setPreviewLogicalIndex] = useState<number | null>(null)
  const [pendingPreviewIndex, setPendingPreviewIndex] = useState<number | null>(null)
  const [viewPreferences, setViewPreferences] = useState<MediaGalleryViewPreferences>(
    xDriveReadMediaGalleryViewPreferences,
  )
  const [viewAnchorRevision, setViewAnchorRevision] = useState(0)
  const viewAnchorIndexRef = useRef(0)
  const [currentTimelineGroupKey, setCurrentTimelineGroupKey] = useState<string | null>(null)
  const [timelineReturnAnchor, setTimelineReturnAnchor] = useState<number | null>(null)
  const [placesMapViewport, setPlacesMapViewport] = useState<XDriveMediaPlacesMapViewport | null>(null)
  const [dayJumpInput, setDayJumpInput] = useState('')
  const [dayJumpFeedback, setDayJumpFeedback] = useState('')
  const galleryRootRef = useRef<HTMLDivElement | null>(null)
  const timeScale = viewPreferences.timeScale
  const effectiveTimeScale: MediaGalleryTimeScale =
    searchActive || currentCleanupReview ? 'all' : timeScale
  const minTileWidth = viewPreferences.densityByScale[effectiveTimeScale]
  const aspectMode = viewPreferences.aspectMode
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const selectionBusyRef = useRef(false)
  const selectionActionGenerationRef = useRef(0)
  const selectionControlRef = useRef<HTMLButtonElement | null>(null)
  const restoreSelectionFocusRef = useRef(false)
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

  useEffect(() => {
    xDriveWriteMediaGalleryViewPreferences(viewPreferences)
  }, [viewPreferences])

  // The existing virtual Grid/Timeline anchor restoration supports an external
  // logical index; only a new sort generation should apply it.
  useEffect(() => {
    if (sortAnchorRevision <= 0 || sortAnchorIndex === undefined ||
        !Number.isSafeInteger(sortAnchorIndex) || sortAnchorIndex < 0) return
    viewAnchorIndexRef.current = sortAnchorIndex
    setViewAnchorRevision((value) => value + 1)
  }, [sortAnchorIndex, sortAnchorRevision])

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
  const personContextTitleRef = useRef<HTMLHeadingElement | null>(null)
  const restorePersonFocusRef = useRef<string | null>(null)

  useEffect(() => {
    if (personNameDialog || suggestionTargetDialog) return
    const suggestionID = restorePersonFocusRef.current
    restorePersonFocusRef.current = null
    // A successful adoption/assignment removes its original suggestion caller.
    // Consume that one success request after the Dialog closes; ordinary
    // navigation, cancellation and failed submissions do not request focus.
    if (suggestionID && !suggestedPeople.some((person) => person.id === suggestionID)) {
      personContextTitleRef.current?.focus()
    }
  }, [personNameDialog, suggestedPeople, suggestionTargetDialog])

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

  const requestGallerySort = useCallback((by: 'captured' | 'added', dir: 'asc' | 'desc') => {
    const index = viewAnchorIndexRef.current
    const anchorNodeID = (virtualCollection?.itemAt(index) ?? items[index])?.node.id
    onSortChange?.(by, dir, anchorNodeID)
  }, [items, onSortChange, virtualCollection])

  const updateGalleryTimeScale = useCallback((nextScale: MediaGalleryTimeScale) => {
    if (nextScale === timeScale) return
    setViewAnchorRevision((current) => current + 1)
    setViewPreferences((current) => ({ ...current, timeScale: nextScale }))
  }, [timeScale])

  const updateGalleryDensity = useCallback((value: number) => {
    const normalized = mediaGalleryNormalizeDensity(value, minTileWidth)
    if (normalized === minTileWidth) return
    setViewAnchorRevision((current) => current + 1)
    setViewPreferences((current) => ({
      ...current,
      densityByScale: {
        ...current.densityByScale,
        [effectiveTimeScale]: normalized,
      },
    }))
  }, [effectiveTimeScale, minTileWidth])

  const updateGalleryAspectMode = useCallback((nextMode: MediaGalleryAspectMode) => {
    if (nextMode === aspectMode) return
    // Same logical rows/columns in either mode; preserve the visible anchor.
    setViewAnchorRevision((current) => current + 1)
    setViewPreferences((current) => ({ ...current, aspectMode: nextMode }))
  }, [aspectMode])

  const jumpToTimelineGroup = useCallback((group: MediaTimelineGroupIndex) => {
    const target = Math.max(0, Math.trunc(group.start_index))
    const original = viewAnchorIndexRef.current
    if (original !== target) setTimelineReturnAnchor(original)
    viewAnchorIndexRef.current = target
    setCurrentTimelineGroupKey(group.key)
    setViewAnchorRevision((current) => current + 1)
  }, [])

  const jumpToTimelineDay = (day: string) => {
    setDayJumpInput(day)
    if (!day) {
      setDayJumpFeedback('')
      return
    }
    const match = xDriveMediaGalleryTimelineNearestDay(dayGroupsForJump, day)
    if (!match) {
      setDayJumpFeedback('当前视图没有可定位的有效日期')
      return
    }
    // The displayed input and current-date feedback reflect the actual
    // indexed date; never silently claim an empty day contains photos.
    setDayJumpInput(match.group.key)
    setDayJumpFeedback(match.exact
      ? ''
      : '所选日期没有照片，已定位至' + xDriveMediaGalleryTimelineGroupLabel(match.group.key))
    jumpToTimelineGroup(match.group)
  }

  const returnToTimelineAnchor = () => {
    if (timelineReturnAnchor === null) return
    const index = Math.max(0, Math.min(
      Math.trunc(timelineReturnAnchor), Math.max(0, logicalItemCount - 1),
    ))
    viewAnchorIndexRef.current = index
    const group = xDriveMediaGalleryTimelineGroupAtIndex(timelineNavigationGroups, index)
    setCurrentTimelineGroupKey(group?.key ?? null)
    setViewAnchorRevision((current) => current + 1)
    setTimelineReturnAnchor(null)
    setDayJumpFeedback('')
    setDayJumpInput('')
  }
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
      : mediaTimelineGroups(items, effectiveTimeScale, sortBy, sortDir, timeZone),
    [effectiveTimeScale, items, sortBy, sortDir, timeZone],
  )
  // Local, non-virtual album views already have grouped media even when the
  // server does not attach timeline_group_sets. Keep their day/year/month
  // navigation working without ever scanning a virtual 100k collection.
  const timelineNavigationGroups = useMemo(
    () => activeTimelineGroups.length > 0 || virtualCollection || effectiveTimeScale === 'all'
      ? activeTimelineGroups
      : denseTimelineGroups.map((group) => ({
          key: group.key,
          item_count: group.items.length,
          start_index: group.startIndex,
        })),
    [activeTimelineGroups, virtualCollection, effectiveTimeScale, denseTimelineGroups],
  )
  const dayGroupsForJump = effectiveTimeScale === 'day'
    ? timelineNavigationGroups
    : timelineGroupSets.day
  const timelineJumpGroups = (
    effectiveTimeScale === 'year' || effectiveTimeScale === 'month'
      ? timelineNavigationGroups
      : timelineGroupSets.month
  ).filter((group) => group.key !== 'unknown')
  const logicalItemCount = virtualCollection?.itemCount ?? items.length

  const timelineGroupsRef = useRef(timelineNavigationGroups)
  timelineGroupsRef.current = timelineNavigationGroups
  const captureVisibleAnchor = useCallback((index: number) => {
    if (!Number.isSafeInteger(index) || index < 0) return
    viewAnchorIndexRef.current = index
    const group = xDriveMediaGalleryTimelineGroupAtIndex(timelineGroupsRef.current, index)
    const key = group?.key ?? null
    setCurrentTimelineGroupKey((current) => current === key ? current : key)
  }, [])

  useEffect(() => {
    const group = xDriveMediaGalleryTimelineGroupAtIndex(timelineNavigationGroups, viewAnchorIndexRef.current)
    setCurrentTimelineGroupKey((current) => current === (group?.key ?? null)
      ? current : group?.key ?? null)
  }, [timelineNavigationGroups, effectiveTimeScale, collectionKey])

  useEffect(() => {
    setTimelineReturnAnchor(null)
    setDayJumpFeedback('')
    setDayJumpInput('')
  }, [collectionKey, sortBy, sortDir, timeZone, logicalItemCount])

  // The non-virtual timeline also reports its visible date. Keep header DOM
  // references once per layout, then find the current header by binary search
  // on scroll rather than scanning every date group at every frame.
  useEffect(() => {
    if (virtualCollection || effectiveTimeScale === 'all' ||
        denseTimelineGroups.length === 0 || typeof window === 'undefined') return
    const root = galleryRootRef.current
    if (!root) return
    const headers = Array.from(root.querySelectorAll<HTMLElement>(
      '[data-xdrive-gallery-sticky-date-start-index]',
    ))
    if (headers.length === 0) return
    const scrollParent = mediaGalleryScrollParent(root)
    const scrollTarget = scrollParent ?? window
    let frame: number | null = null
    const update = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const top = scrollParent ? scrollParent.getBoundingClientRect().top : 0
        let lower = 0
        let upper = headers.length
        while (lower < upper) {
          const middle = Math.floor((lower + upper) / 2)
          if (headers[middle].getBoundingClientRect().top <= top + 8) lower = middle + 1
          else upper = middle
        }
        const firstVisible = headers[Math.max(0, lower - 1)]
        const index = Number(firstVisible.dataset.xdriveGalleryStickyDateStartIndex)
        if (Number.isSafeInteger(index)) captureVisibleAnchor(index)
      })
    }
    scrollTarget.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      scrollTarget.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [virtualCollection, effectiveTimeScale, denseTimelineGroups, captureVisibleAnchor])


  useLayoutEffect(() => {
    if (viewAnchorRevision <= 0 || virtualCollection) return
    const root = galleryRootRef.current
    if (!root) return
    const frame = window.requestAnimationFrame(() => {
      const target = root.querySelector<HTMLElement>(
        `[data-xdrive-media-index="${viewAnchorIndexRef.current}"]`,
      )
      target?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [effectiveTimeScale, minTileWidth, viewAnchorRevision, virtualCollection])

  const openMediaItem = useCallback((item: MediaItem) => setSelected(item), [])
  const handleFoldExpandClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onExpandFold || !(event.target instanceof Element)) return
    const trigger = event.target.closest<HTMLElement>('[data-xdrive-media-fold-expand]')
    if (!trigger) return
    const tile = trigger.closest<HTMLElement>('[data-xdrive-media-tile]')
    if (!tile) return
    event.preventDefault()
    event.stopPropagation()
    const index = Number(tile.dataset.xdriveMediaIndex)
    if (!Number.isSafeInteger(index) || index < 0) return
    const item = virtualCollection?.itemAt(index) ?? items[index]
    if (item?.fold_member_ids && item.fold_member_ids.length > 1) {
      onExpandFold(item)
    }
  }, [items, onExpandFold, virtualCollection])

  // Root-level gesture owner: one listener set for a 100k-item virtual grid.
  // The time-based hold arms context intent, but creates no Portal until
  // pointerup, so movement can still scroll or reach an eligible drag target.
  const galleryTouchPressRef = useRef<{
    pointerId: number
    start: { x: number; y: number }
    item: MediaItem
    index: number
    timer: number
    held: boolean
  } | null>(null)
  const galleryHoldClickRef = useRef<number | null>(null)

  const clearGalleryTouchPress = useCallback((pointerId?: number) => {
    const press = galleryTouchPressRef.current
    if (!press || (pointerId !== undefined && press.pointerId !== pointerId)) return
    window.clearTimeout(press.timer)
    galleryTouchPressRef.current = null
  }, [])

  useEffect(() => () => clearGalleryTouchPress(), [clearGalleryTouchPress, section])

  const handleGalleryPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && !event.isPrimary) {
      clearGalleryTouchPress()
      galleryHoldClickRef.current = null
      return
    }
    if (event.pointerType !== 'touch') galleryHoldClickRef.current = null
    if (event.pointerType !== 'touch' || selectionMode || typeof window === 'undefined') return
    const target = event.target
    if (!(target instanceof Element) || target.closest('button, input, [role="checkbox"], [data-xdrive-media-fold-expand]')) return
    const tile = target.closest<HTMLElement>('[data-xdrive-media-tile]')
    if (!tile) return
    const index = Number(tile.dataset.xdriveMediaIndex)
    if (!Number.isSafeInteger(index) || index < 0) return
    const item = virtualCollection?.itemAt(index) ?? items[index]
    if (!item) return
    clearGalleryTouchPress()
    galleryHoldClickRef.current = null
    const pointerId = event.pointerId
    const start = { x: event.clientX, y: event.clientY }
    const timer = window.setTimeout(() => {
      const press = galleryTouchPressRef.current
      if (!press || press.pointerId !== pointerId || press.held) return
      press.held = true
      galleryHoldClickRef.current = pointerId
    }, XDRIVE_MOBILE_ITEM_HOLD_MS)
    galleryTouchPressRef.current = { pointerId, start, item, index, timer, held: false }
  }

  const handleGalleryPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = galleryTouchPressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    if (!xDriveMobileItemMoved(press.start, { x: event.clientX, y: event.clientY })) return
    // The timeline has no eligible folder/album reorder target. Movement
    // cancels the menu intent instead of arbitrarily reordering photos.
    clearGalleryTouchPress(event.pointerId)
  }

  const handleGalleryPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = galleryTouchPressRef.current
    clearGalleryTouchPress(event.pointerId)
    if (!press?.held || press.pointerId !== event.pointerId) {
      if (galleryHoldClickRef.current === event.pointerId) galleryHoldClickRef.current = null
      return
    }
    const document = galleryRootRef.current?.ownerDocument
    if (document) {
      const blockHeldClick = (click: MouseEvent) => {
        const clickPointer = (click as MouseEvent & { pointerId?: number }).pointerId
        if (click.detail === 0 || (clickPointer !== undefined && clickPointer > 0 && clickPointer !== press.pointerId)) return
        click.preventDefault()
        click.stopImmediatePropagation()
        if (galleryHoldClickRef.current === press.pointerId) galleryHoldClickRef.current = null
        document.removeEventListener('click', blockHeldClick, true)
      }
      document.addEventListener('click', blockHeldClick, true)
      window.setTimeout(() => {
        document.removeEventListener('click', blockHeldClick, true)
        if (galleryHoldClickRef.current === press.pointerId) galleryHoldClickRef.current = null
      }, 350)
    }
    setMediaContextMenu({ item: press.item, index: press.index, top: press.start.y, left: press.start.x })
  }

  const handleGalleryPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearGalleryTouchPress(event.pointerId)
    if (galleryHoldClickRef.current === event.pointerId) galleryHoldClickRef.current = null
    // A cancelled hold is never an activation or a menu action.
  }

  const consumeGalleryHoldClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (galleryHoldClickRef.current === null || event.detail === 0) return
    const pointerId = (event.nativeEvent as MouseEvent & { pointerId?: number }).pointerId
    if (pointerId !== undefined && pointerId > 0 && pointerId !== galleryHoldClickRef.current) return
    galleryHoldClickRef.current = null
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMediaContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // Prevent native touch ContextMenu from preempting the held contact.
    if (galleryTouchPressRef.current || galleryHoldClickRef.current !== null) {
      event.preventDefault()
      return
    }
    // Delegated to the Gallery root: 100k logical media never create 100k menus.
    const tile = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-xdrive-media-tile]')
      : null
    if (!tile) return
    const index = Number(tile.dataset.xdriveMediaIndex)
    if (!Number.isSafeInteger(index) || index < 0) return
    const item = virtualCollection?.itemAt(index) ?? items[index]
    if (!item) return
    event.preventDefault()
    setMediaContextMenu({ item, index, top: event.clientY, left: event.clientX })
  }, [items, virtualCollection])
  const openMediaPreview = useCallback((item: MediaItem, index?: number) => {
    // Deleted media cannot be previewed; the same tile click must still work.
    if (section === 'trash') {
      setSelected(item)
      return
    }
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
      setSelected((current) => current ? item : null)
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
    setSelected((current) => current ? item : null)
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
    setSelected(null)
    setPreviewItem(null)
    setPreviewLogicalIndex(null)
    setPendingPreviewIndex(null)
  }, [])

  const openPreviewInfo = useCallback((item: MediaItem) => {
    setSelected((current) => current?.node.id === item.node.id ? null : item)
  }, [])

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
    restoreFocusAfterClear = false,
  ) => {
    if (selectedMedia.length === 0 || selectionBusyRef.current) return
    const actionGeneration = selectionActionGenerationRef.current
    const isCurrent = () => (
      actionGeneration === selectionActionGenerationRef.current
    )
    selectionBusyRef.current = true
    setSelectionBusy(true)
    try {
      await action(selectedMedia)
      if (isCurrent() && clearAfter) {
        if (restoreFocusAfterClear) restoreSelectionFocusRef.current = true
        clearMediaSelection()
      }
    } finally {
      if (isCurrent()) {
        selectionBusyRef.current = false
        setSelectionBusy(false)
      }
    }
  }, [clearMediaSelection, selectedMedia])

  useEffect(() => {
    if (selectionMode || !restoreSelectionFocusRef.current) return
    restoreSelectionFocusRef.current = false
    // Successful album assignment removes the picker and its initiating button.
    // Return after their cleanup to the Gallery control that remains mounted.
    selectionControlRef.current?.focus()
  }, [selectionMode])

  useEffect(() => {
    selectionActionGenerationRef.current += 1
    selectionBusyRef.current = false
    setSelectionBusy(false)
    clearMediaSelection()
    setCollageDialogItems(null)
    setMovieDialogItems(null)
    setMediaContextMenu(null)
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
    currentFolderView?.current.id,
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
    !currentFolderView &&
    !currentSuggestedPerson &&
    !currentPerson &&
    !currentPet &&
    !currentMemory &&
    !currentCleanupReview &&
    !activePlaceID
  const showMemoriesIndex = isRootSection && section === 'memories'
  const showCleanupIndex = isRootSection && section === 'cleanup'
  const onChooseCollectionCover = currentPerson && onSetPersonCover
    ? (item: MediaItem) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
    : currentAlbum?.kind === 'manual' && onSetAlbumCover
      ? (item: MediaItem) => {
          void onSetAlbumCover(currentAlbum, item).catch(() => undefined)
        }
      : undefined
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
  const showCollectionFilters =
    showPhotoCollection &&
    !isTrashSection &&
    !currentMemory &&
    !currentPet &&
    !currentCleanupReview
  const showCollectionTimeScale =
    showPhotoCollection &&
    !isTrashSection &&
    !searchActive &&
    !currentCleanupReview
  const blockingCollectionError = Boolean(
    showPhotoCollection &&
    collectionError &&
    logicalItemCount === 0 &&
    !loading,
  )
  const emptyCollectionTitle = isTrashSection
    ? '回收站为空'
    : currentFolderView
      ? '当前目录没有直接照片或视频'
    : isRootSection && section === 'favorites'
      ? '还没有收藏的照片或视频'
      : isRootSection && section === 'media-types' && mediaTypeLabel
        ? `还没有${mediaTypeLabel}`
        : filtersActive
          ? '没有符合当前条件的照片或视频'
          : '还没有照片和视频'
  const emptyCollectionDescription = isTrashSection
    ? '删除的照片和视频会显示在这里。'
    : currentFolderView
      ? currentFolderView.children.length > 0
        ? '可以进入上方子目录继续浏览；当前目录不会递归展开子目录照片。'
        : '此目录当前没有可显示的本地媒体。'
    : filtersActive
      ? '可以调整搜索或筛选条件后再试。'
      : '上传文件或添加同步文件夹后，媒体会自动出现在图库中。'
  const cleanupRecommendedNodeID = currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? currentCleanupReview.group.asset_comparison === 'identical'
        ? currentCleanupReview.group.recommended_keep_node_id
        : undefined
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

  const lockedAppliedFilterKeys: XDriveGalleryAppliedFilterKey[] = [
    ...(section === 'favorites' ? ['favorite' as const] : []),
    ...(currentPerson ? ['person_identity' as const] : []),
    ...(section === 'media-types' && activeMediaType
      ? ['asset_kind' as const, 'category' as const]
      : []),
  ]
  const appliedChips = xDriveGalleryAppliedChips(appliedQuery, {
    timeZone,
    locked: lockedAppliedFilterKeys,
    placeLabel: places.find((place) => place.id === appliedQuery.place)?.name,
    personLabel: currentPerson?.name ||
      people.find((person) => person.id === appliedQuery.person_identity)?.name,
  })

  const galleryTitle = currentFolderView
    ? currentFolderView.current.name
    : currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? '主原文件重复'
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
  const gallerySubtitle = currentFolderView
    ? `${currentFolderView.source.source_name} · ${currentFolderView.current.path} · 当前目录 ${currentFolderView.current.direct_media_count.toLocaleString('zh-CN')} 个媒体 · ${currentFolderView.current.child_folder_count.toLocaleString('zh-CN')} 个子目录`
    : currentCleanupReview
    ? currentCleanupReview.kind === 'duplicate'
      ? `${currentCleanupReview.group.item_count.toLocaleString('zh-CN')} 个主原文件相同副本 · ${currentCleanupReview.group.recommendation_reason}`
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
              ? '主原文件重复与连拍精选；清理操作仍然先进入回收站'
            : section === 'albums'
            ? '同步文件夹、手动相册、智能相册和导入相册'
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
                    : collectionError && logicalItemCount === 0
                      ? '图库数据暂时不可用'
                      : loading && logicalItemCount === 0
                        ? '正在加载照片和视频'
                        : `${logicalItemCount.toLocaleString('zh-CN')} 个项目 · 所有 xDrive 图片和视频，包括普通上传和同步文件夹文件`
  const canBack = Boolean(
    currentFolderView ||
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
      ref={galleryRootRef}
      spacing={2}
      onContextMenu={handleMediaContextMenu}
      onPointerDownCapture={handleGalleryPointerDown}
      onPointerMoveCapture={handleGalleryPointerMove}
      onPointerUpCapture={handleGalleryPointerUp}
      onPointerCancelCapture={handleGalleryPointerCancel}
      onClickCapture={(event) => {
        consumeGalleryHoldClick(event)
        if (!event.isPropagationStopped()) handleFoldExpandClick(event)
      }}
      data-xdrive-gallery-aspect-mode={aspectMode}
      sx={{
        minWidth: 0,
        // Do not change the square grid's row heights/virtual range. Only stop
        // cropping the already-decoded still/video/Live thumbnail image.
        '& [data-xdrive-media-tile] img': {
          objectFit: aspectMode === 'contain' ? 'contain' : 'cover',
        },
        pr: { lg: selected && !previewItem ? '380px' : 0 },
        transition: 'padding-right 160ms ease',
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1.25}
        alignItems={{ xs: 'stretch', lg: 'center' }}
        data-xdrive-gallery-header
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: { xs: '0 0 auto', lg: '1 1 320px' }, minWidth: 0 }}>
          {canBack && onBack ? (
            <Tooltip title="返回上一级">
              <IconButton
                onClick={onBack}
                size="small"
                aria-label="返回上一级"
                sx={currentPerson || currentSuggestedPerson || activePlaceID ? personTouchTargetSx : undefined}
              >
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          ) : null}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h5"
              ref={personContextTitleRef}
              tabIndex={-1}
              variant="h5"
              fontWeight={700}
              noWrap
            >
              {galleryTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {gallerySubtitle}
            </Typography>
          </Box>
        </Stack>

        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          flexWrap="wrap"
          alignItems="center"
          justifyContent={{ xs: 'flex-start', lg: 'flex-end' }}
          sx={{ flex: '1 1 auto', minWidth: 0 }}
        >
          {showCollectionFilters && filters ? (
            <Box sx={{ flex: '1 1 360px', minWidth: { xs: 0, sm: 300 }, maxWidth: 560 }}>
              {filters}
            </Box>
          ) : null}
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
          {currentAlbum?.kind === 'manual' && onSetAlbumCover ? (
            <Button size="small" variant="text" onClick={() => {
              void onSetAlbumCover(currentAlbum).catch(() => undefined)
            }}>
              恢复自动封面
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
              sx={personTouchTargetSx}
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
              sx={personTouchTargetSx}
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
              sx={personTouchTargetSx}
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
              sx={personTouchTargetSx}
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
              sx={personTouchTargetSx}
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
          {onRefresh ? (
            <Tooltip title="刷新">
              <span>
                <IconButton
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label="刷新图库"
                  size="small"
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>

      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', lg: 'center' }}
        justifyContent="space-between"
        data-xdrive-gallery-toolbar
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          {onSectionChange ? (
            <XDriveMediaGalleryNavigation value={section} onChange={onSectionChange} />
          ) : null}
        </Box>
        {showPhotoCollection ? (
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            alignItems="center"
            justifyContent={{ xs: 'flex-start', lg: 'flex-end' }}
            sx={{ flexShrink: 0 }}
          >
            {onToggleFoldDuplicates && !isTrashSection &&
             !currentFolderView && !currentCleanupReview &&
             !currentMemory && !currentPet && !currentPerson && !currentSuggestedPerson ? (
              <Button
                size="small"
                variant={foldDuplicates ? 'contained' : 'outlined'}
                aria-pressed={foldDuplicates}
                data-xdrive-gallery-fold-duplicates
                onClick={() => onToggleFoldDuplicates(!foldDuplicates)}
              >
                {foldDuplicates ? '折叠相同副本：开' : '折叠相同副本'}
              </Button>
            ) : null}
            <Button
              ref={selectionControlRef}
              size="small"
              variant={selectionMode ? 'contained' : 'text'}
              onClick={() => {
                if (selectionMode) clearMediaSelection()
                else setSelectionMode(true)
              }}
            >
              {selectionMode ? '完成' : '选择'}
            </Button>
            {((showPhotoCollection && !isTrashSection) || section === 'memories') && onTimeZoneChange ? (
              <Autocomplete
                freeSolo
                size="small"
                options={availableTimeZones}
                value={timeZone}
                onChange={(_event, value) => {
                  if (typeof value === 'string') onTimeZoneChange(value)
                }}
                renderInput={(params) => (
                  <TextField {...params} label="日期时区" aria-label="图库日期时区"
                    helperText="拍摄、筛选和回忆共用" />
                )}
                sx={{ minWidth: 176, maxWidth: 260 }}
                data-xdrive-gallery-time-zone
              />
            ) : null}
            {showPhotoCollection && !isTrashSection && !searchActive &&
             !currentMemory && !currentPet && !currentCleanupReview && onSortChange ? (
              <Stack direction="row" spacing={0.75}>
                <TextField
                  select
                  size="small"
                  label="排序依据"
                  value={sortBy}
                  onChange={(event) => requestGallerySort(event.target.value as 'captured' | 'added', sortDir)}
                  data-xdrive-gallery-sort-by
                  sx={{ minWidth: 112 }}
                >
                  <MenuItem value="captured">拍摄时间</MenuItem>
                  <MenuItem value="added">加入时间</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label="排序方向"
                  value={sortDir}
                  onChange={(event) => requestGallerySort(sortBy, event.target.value as 'asc' | 'desc')}
                  data-xdrive-gallery-sort-dir
                  sx={{ minWidth: 100 }}
                >
                  <MenuItem value="desc">最新在前</MenuItem>
                  <MenuItem value="asc">最早在前</MenuItem>
                </TextField>
              </Stack>
            ) : null}
            {showCollectionTimeScale ? (
              <Stack direction="row" spacing={0.25} useFlexGap flexWrap="wrap"
                aria-label="图库时间尺度"
                sx={{ '& .MuiButton-root': { '@media (max-width:899.95px)': { minHeight: 44 } } }}>
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
                    onClick={() => updateGalleryTimeScale(value)}
                  >
                    {label}
                  </Button>
                ))}
              </Stack>
            ) : null}
            {showCollectionTimeScale && timelineJumpGroups.length > 1 ? (
              <TextField
                select
                size="small"
                value=""
                aria-label={effectiveTimeScale === 'year' ? '跳转年份' : '跳转年月'}
                data-xdrive-gallery-timeline-jump
                onChange={(event) => {
                  const group = timelineJumpGroups.find(
                    (candidate) => candidate.key === event.target.value,
                  )
                  if (group) jumpToTimelineGroup(group)
                }}
                sx={{
                  minWidth: 126,
                  '@media (max-width:899.95px)': {
                    '& .MuiInputBase-root .MuiSelect-select': {
                      minHeight: 44,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                    },
                  },
                }}
              >
                <MenuItem value="">
                  {effectiveTimeScale === 'year' ? '跳转年份' : '跳转年月'}
                </MenuItem>
                {timelineJumpGroups.map((group) => (
                  <MenuItem key={group.key} value={group.key}>
                    {xDriveMediaGalleryTimelineGroupLabel(group.key)}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {showCollectionTimeScale && effectiveTimeScale === 'day' ? (
              <TextField
                size="small"
                type="date"
                label="跳转日期"
                aria-label="跳转日期"
                data-xdrive-gallery-timeline-day-jump
                value={dayJumpInput}
                disabled={dayGroupsForJump.length === 0 ||
                  dayGroupsForJump[0]?.key === 'unknown'}
                onChange={(event) => jumpToTimelineDay(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ minWidth: 160, '& .MuiInputBase-root': { minHeight: 44 } }}
              />
            ) : null}
            {showCollectionTimeScale && effectiveTimeScale !== 'all' ? (
              <Typography
                variant="caption"
                color="text.secondary"
                role="status"
                data-xdrive-gallery-timeline-current-date
                sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', minWidth: 0 }}
              >
                {'当前浏览：' + (currentTimelineGroupKey
                  ? xDriveMediaGalleryTimelineGroupLabel(currentTimelineGroupKey)
                  : '尚无可定位日期')}
              </Typography>
            ) : null}
            {showCollectionTimeScale && effectiveTimeScale === 'day' && dayJumpFeedback ? (
              <Typography role="status" variant="caption" color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}>
                {dayJumpFeedback}
              </Typography>
            ) : null}
            {showCollectionTimeScale && timelineReturnAnchor !== null ? (
              <Button
                size="small"
                variant="outlined"
                data-xdrive-gallery-timeline-return
                onClick={returnToTimelineAnchor}
                sx={{ minHeight: 44 }}
              >
                返回刚才位置
              </Button>
            ) : null}
            <Stack direction="row" spacing={0.25} aria-label="照片墙显示比例">
              <Button
                size="small"
                variant={aspectMode === 'crop' ? 'contained' : 'text'}
                aria-pressed={aspectMode === 'crop'}
                data-xdrive-gallery-aspect-crop
                onClick={() => updateGalleryAspectMode('crop')}
              >
                方形裁切
              </Button>
              <Button
                size="small"
                variant={aspectMode === 'contain' ? 'contained' : 'text'}
                aria-pressed={aspectMode === 'contain'}
                data-xdrive-gallery-aspect-contain
                onClick={() => updateGalleryAspectMode('contain')}
              >
                原比例完整显示
              </Button>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                缩略图大小
              </Typography>
              <Slider
                size="small"
                aria-label="缩略图密度"
                min={XDRIVE_MEDIA_GALLERY_DENSITY_MIN}
                max={XDRIVE_MEDIA_GALLERY_DENSITY_MAX}
                step={XDRIVE_MEDIA_GALLERY_DENSITY_STEP}
                value={minTileWidth}
                onChange={(_event, value) => {
                  if (typeof value === 'number') updateGalleryDensity(value)
                }}
                sx={{ width: 120 }}
              />
            </Stack>
          </Stack>
        ) : null}
      </Stack>

      {showCollectionFilters ? (
        <Stack
          direction="row"
          spacing={0.75}
          flexWrap="wrap"
          useFlexGap
          alignItems="center"
          data-xdrive-gallery-search-feedback
          aria-live="polite"
        >
          <Typography variant="caption" color="text.secondary">
            {'范围：' + (appliedScopeLabel || galleryTitle) + ' · '}
            {loading ? '正在查询…'
              : collectionError ? '查询失败'
                : logicalItemCount.toLocaleString('zh-CN') + ' 个匹配项目'}
          </Typography>
          {appliedChips.map((chip) => (
            <Chip
              key={chip.key}
              size="small"
              variant="outlined"
              label={chip.label}
              onDelete={chip.removable && onRemoveAppliedFilter
                ? () => onRemoveAppliedFilter(chip.key)
                : undefined}
              data-xdrive-gallery-applied-filter={chip.key}
            />
          ))}
          {draftPending ? (
            <Typography variant="caption" color="text.secondary" data-xdrive-gallery-pending-filters>
              条件已修改，尚未应用
            </Typography>
          ) : null}
          {searchActive ? (
            <Typography variant="caption" color="text.secondary">
              {searchOrder === 'relevance' ? '按语义相关度排列' : '按基础匹配结果排列'}
            </Typography>
          ) : null}
          {onRequestIndexStatus ? (
            <Button
              size="small"
              variant="text"
              disabled={indexStatusLoading}
              onClick={onRequestIndexStatus}
              data-xdrive-gallery-index-status-request
            >
              {indexStatusLoading ? '检查索引中…' : indexStatus ? '刷新索引状态' : '查看索引状态'}
            </Button>
          ) : null}
          {indexStatus ? (
            <Typography variant="caption" color="text.secondary" data-xdrive-gallery-index-status>
              {'已识别资产索引：' + indexStatus.ready_assets.toLocaleString('zh-CN') +
                ' / ' + indexStatus.known_assets.toLocaleString('zh-CN') + ' 就绪'}
              {indexStatus.failed_assets > 0 ? ' · 失败 ' + indexStatus.failed_assets : ''}
              {indexStatus.unsupported_assets > 0 ? ' · 不支持 ' + indexStatus.unsupported_assets : ''}
              {indexStatus.missing_metadata_assets > 0
                ? ' · 缺少元数据 ' + indexStatus.missing_metadata_assets : ''}
              {indexStatus.other_unready_assets > 0
                ? ' · 其他未就绪 ' + indexStatus.other_unready_assets : ''}
              {' · 仅已识别照片资产，不表示全库文件已扫描'}
            </Typography>
          ) : searchActive ? (
            <Typography variant="caption" color="text.secondary">
              索引覆盖尚未核验
            </Typography>
          ) : null}
          {indexStatusError ? (
            <Typography variant="caption" color="error" data-xdrive-gallery-index-status-error>
              {'索引检查失败：' + indexStatusError}
            </Typography>
          ) : null}
          {appliedChips.some((chip) => chip.removable) && onClearFilters ? (
            <Button size="small" variant="text" onClick={onClearFilters}>
              清除已生效条件
            </Button>
          ) : null}
        </Stack>
      ) : null}

      {showPhotoCollection && selectionMode ? (
        <XDriveMediaGallerySelectionToolbar
          selectedCount={selectedMedia.length}
          selectionIdentity={selectedMediaItems}
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
                true,
                true,
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
          bursts={burstReviews}
          loading={loading}
          loadThumbnail={loadThumbnail}
          onOpenBurst={onOpenBurstReview}
          onLoadMoreBurst={onLoadMoreBurst}
          onRefresh={onRefresh}
          loadingMore={cleanupMoreLoading}
          indexStatus={indexStatus}
          indexStatusLoading={indexStatusLoading}
          indexStatusError={indexStatusError}
          onRequestIndexStatus={onRequestIndexStatus}
        />
      ) : null}

      {showAlbumIndex && syncFoldersError ? (
        <XDriveStatusAlert tone="bad">{syncFoldersError}</XDriveStatusAlert>
      ) : null}

      {showAlbumIndex && (syncFoldersLoading || syncFolders.length > 0) ? (
        <Box data-xdrive-gallery-sync-folders>
          <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mb: 1.25 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              同步文件夹
            </Typography>
            <Typography variant="caption" color="text.secondary">
              按 xDrive 本地同步目录逐层浏览，不递归展开子目录
            </Typography>
          </Stack>
          {syncFoldersLoading && syncFolders.length === 0 ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 80 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                正在加载同步文件夹…
              </Typography>
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 1.5,
              }}
            >
              {syncFolders.map((folder) => (
                <Paper
                  key={folder.source_id}
                  variant="outlined"
                  role={onOpenSyncFolder ? 'button' : undefined}
                  tabIndex={onOpenSyncFolder ? 0 : undefined}
                  data-xdrive-gallery-sync-folder={folder.source_id}
                  onClick={() => onOpenSyncFolder?.(folder)}
                  onKeyDown={(event) => {
                    if (onOpenSyncFolder) keyboardActivate(event, () => onOpenSyncFolder(folder))
                  }}
                  sx={{
                    overflow: 'hidden',
                    cursor: onOpenSyncFolder ? 'pointer' : 'default',
                    '&:hover': onOpenSyncFolder ? { boxShadow: 2 } : undefined,
                  }}
                >
                  <Box sx={{ aspectRatio: '16 / 9', overflow: 'hidden' }}>
                    <XDriveMediaAsyncThumbnail
                      nodeID={folder.cover_node_id}
                      alt={folder.source_name}
                      loadThumbnail={loadThumbnail}
                      fallback={(
                        <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'text.secondary' }}>
                          <FolderOutlinedIcon sx={{ fontSize: 44 }} />
                        </Box>
                      )}
                    />
                  </Box>
                  <Box sx={{ px: 1.5, py: 1.2 }}>
                    <Typography variant="body2" fontWeight={650} noWrap>
                      {folder.source_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {folder.target_path}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {folder.direct_media_count.toLocaleString('zh-CN')} 个媒体 · {folder.child_folder_count.toLocaleString('zh-CN')} 个子目录
                    </Typography>
                  </Box>
                </Paper>
              ))}
            </Box>
          )}
        </Box>
      ) : null}

      {showAlbumIndex ? (
        <XDriveMediaGalleryAlbumOrganizer
          key={preferenceScope || 'gallery-default'}
          albums={albums}
          accountScope={preferenceScope}
          loadThumbnail={loadThumbnail}
          onOpenAlbum={onOpenAlbum}
          folderActions={albumFolderActions}
        />
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
            initialViewport={placesMapViewport ?? undefined}
            onViewportChange={setPlacesMapViewport}
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
                    sx={{ mt: 0.5, '& .MuiButton-root': personTouchTargetSx }}
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

      {currentFolderView ? (
        <Stack spacing={1.25} data-xdrive-gallery-folder-browser>
          {onIncludeDescendantsChange ? (
            <FormControlLabel
              control={(
                <Switch
                  checked={includeDescendants}
                  onChange={(event) => onIncludeDescendantsChange(event.target.checked)}
                  inputProps={{ 'aria-label': '包含子目录中的照片与视频' }}
                />
              )}
              label="包含子目录"
              sx={{ alignSelf: 'flex-start', minHeight: 44 }}
            />
          ) : null}
          <Breadcrumbs aria-label="同步文件夹路径" maxItems={6}>
            {currentFolderView.breadcrumbs.map((breadcrumb, index) => (
              index === currentFolderView.breadcrumbs.length - 1 ? (
                <Typography key={breadcrumb.id} variant="body2" color="text.primary" noWrap>
                  {breadcrumb.name}
                </Typography>
              ) : (
                <Button
                  key={breadcrumb.id}
                  size="small"
                  variant="text"
                  onClick={() => onOpenFolderBreadcrumb?.(breadcrumb)}
                  sx={{ minWidth: 0, px: 0.5 }}
                >
                  {breadcrumb.name}
                </Button>
              )
            ))}
          </Breadcrumbs>
          {currentFolderView.children.length > 0 ? (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                子目录
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 1,
                }}
              >
                {currentFolderView.children.map((folder) => (
                  <Paper
                    key={folder.id}
                    variant="outlined"
                    role={onOpenFolder ? 'button' : undefined}
                    tabIndex={onOpenFolder ? 0 : undefined}
                    data-xdrive-gallery-folder={folder.id}
                    onClick={() => onOpenFolder?.(folder)}
                    onKeyDown={(event) => {
                      if (onOpenFolder) keyboardActivate(event, () => onOpenFolder(folder))
                    }}
                    sx={{
                      p: 1.25,
                      cursor: onOpenFolder ? 'pointer' : 'default',
                      '&:hover': onOpenFolder ? { boxShadow: 1 } : undefined,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FolderOutlinedIcon color="action" />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={650} noWrap>
                          {folder.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>
                          {folder.direct_media_count.toLocaleString('zh-CN')} 个媒体 · {folder.child_folder_count.toLocaleString('zh-CN')} 个子目录
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Box>
          ) : null}
        </Stack>
      ) : null}

      {showPhotoCollection ? (
        <Box>
        {blockingCollectionError ? (
          <Paper
            variant="outlined"
            data-xdrive-gallery-load-error
            sx={{ minHeight: 200, display: 'grid', placeItems: 'center', p: 3 }}
          >
            <Stack alignItems="center" spacing={1.25} sx={{ maxWidth: 520, textAlign: 'center' }}>
              <Typography variant="subtitle1" fontWeight={700}>
                图库加载失败
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {collectionError}
              </Typography>
              {onRefresh ? (
                <Button size="small" variant="outlined" onClick={onRefresh} disabled={loading}>
                  重试
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ) : loading && logicalItemCount === 0 ? (
          <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
            <Stack alignItems="center" spacing={1}>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">
                正在加载图库…
              </Typography>
            </Stack>
          </Box>
        ) : logicalItemCount === 0 ? (
          <Paper
            variant="outlined"
            data-xdrive-gallery-empty
            sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
          >
            <Stack alignItems="center" spacing={1} sx={{ maxWidth: 460, textAlign: 'center' }}>
              <ImageIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography fontWeight={650}>
                {emptyCollectionTitle}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {emptyCollectionDescription}
              </Typography>
              {filtersActive && section === 'library' && onClearFilters ? (
                <Button size="small" variant="text" onClick={onClearFilters}>
                  清除筛选
                </Button>
              ) : null}
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
              saveVideoPoster={saveVideoPoster}
              onSetFavorite={collectionSetFavorite}
              onSetCover={onChooseCollectionCover}
              selectionMode={selectionMode}
              selectedNodeIDs={selectedNodeIDs}
              onSelect={handleMediaSelect}
              onOpen={openMediaItem}
              onPreview={openMediaPreview}
              onToggleFavorite={toggleMediaFavorite}
              restoreAnchorIndex={viewAnchorIndexRef.current}
              restoreAnchorRevision={viewAnchorRevision}
              onVisibleAnchorChange={captureVisibleAnchor}
            />
          ) : (
            <Stack spacing={2.5}>
              {denseTimelineGroups.map((group) => (
                <Box key={group.key}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="baseline"
                    data-xdrive-gallery-sticky-date
                    data-xdrive-gallery-sticky-date-start-index={group.startIndex}
                    sx={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      mb: 1,
                      bgcolor: 'background.paper',
                    }}
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
                    saveVideoPoster={saveVideoPoster}
                    onSetFavorite={collectionSetFavorite}
                    onSetCover={onChooseCollectionCover}
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
            saveVideoPoster={saveVideoPoster}
            onSetFavorite={collectionSetFavorite}
            onSetCover={onChooseCollectionCover}
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
            recommendedNodeID={cleanupRecommendedNodeID}
            restoreAnchorIndex={viewAnchorIndexRef.current}
            restoreAnchorRevision={viewAnchorRevision}
            onVisibleAnchorChange={captureVisibleAnchor}
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
            saveVideoPoster={saveVideoPoster}
            onSetFavorite={collectionSetFavorite}
            onSetCover={onChooseCollectionCover}
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
            recommendedNodeID={cleanupRecommendedNodeID}
          />
        )}
        </Box>
      ) : null}

      {showAlbumIndex &&
      albums.length === 0 &&
      syncFolders.length === 0 &&
      !loading &&
      !syncFoldersLoading ? (
        <Paper variant="outlined" sx={{ minHeight: 160, display: 'grid', placeItems: 'center', p: 3 }}>
          <Typography color="text.secondary">还没有相册</Typography>
        </Paper>
      ) : null}
      {showPlacesIndex && placesStatus === 'loading' ? (
        <Typography role="status" color="text.secondary">正在加载地点…</Typography>
      ) : null}
      {showPlacesIndex && places.length === 0 && !loading && placesStatus === 'ready' ? (
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
        loadMusicRoot={loadMusicRoot}
        listMusicChildren={listMusicChildren}
        onCreate={onCreateCreativeGeneration}
        onGet={onGetCreativeGeneration}
        onCancel={onCancelCreativeGeneration}
        onCompleted={() => {
          clearMediaSelection()
          if (onRefresh) onRefresh()
        }}
        onClose={() => setMovieDialogItems(null)}
      />

      <Menu
        open={Boolean(mediaContextMenu)}
        onClose={() => setMediaContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={mediaContextMenu ? { top: mediaContextMenu.top, left: mediaContextMenu.left } : undefined}
        data-xdrive-gallery-media-context-menu
      >
        {!isTrashSection ? (
          <MenuItem onClick={() => {
            if (mediaContextMenu) openMediaPreview(mediaContextMenu.item, mediaContextMenu.index)
            setMediaContextMenu(null)
          }}>
            打开
          </MenuItem>
        ) : null}
        {!isTrashSection && onExportLivePhoto &&
        (mediaContextMenu?.item.live_photo || mediaContextMenu?.item.asset_kind === 'live_photo') ? (
          <MenuItem onClick={() => {
            const item = mediaContextMenu!.item
            setMediaContextMenu(null)
            void onExportLivePhoto(item).catch(() => undefined)
          }}>
            导出完整实况
          </MenuItem>
        ) : null}
        {!isTrashSection && onSetFavorite && mediaContextMenu ? (
          <MenuItem onClick={() => {
            toggleMediaFavorite(mediaContextMenu.item)
            setMediaContextMenu(null)
          }}>{mediaContextMenu.item.favorite ? '取消收藏' : '收藏'}</MenuItem>
        ) : null}
        {mediaContextMenu ? (
          <MenuItem onClick={() => {
            handleMediaSelect(mediaContextMenu.item, mediaContextMenu.index, { ctrlKey: false, metaKey: false, shiftKey: false })
            setMediaContextMenu(null)
          }}>选择</MenuItem>
        ) : null}
        {onExpandFold && mediaContextMenu?.item.fold_member_ids && mediaContextMenu.item.fold_member_ids.length > 1 ? (
          <MenuItem onClick={() => {
            onExpandFold(mediaContextMenu.item)
            setMediaContextMenu(null)
          }}>展开副本</MenuItem>
        ) : null}
        <MenuItem onClick={() => {
          if (mediaContextMenu) openMediaItem(mediaContextMenu.item)
          setMediaContextMenu(null)
        }}>
          属性
        </MenuItem>
      </Menu>

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
        onExportLivePhoto={onExportLivePhoto}
        onShare={onShareItem}
        onDelete={onDeleteItems
          ? (item) => onDeleteItems([item])
          : undefined}
        onClose={closeMediaPreview}
      />

      <XDriveMediaDetailsInspector
        item={selected}
        overlayZIndex={previewItem ? 1400 : undefined}
        showPreview={!previewItem}
        loadThumbnail={loadThumbnail}
        loadNodeLocation={isTrashSection ? undefined : loadNodeLocation}
        onShowInFolder={isTrashSection ? undefined : onShowInFolder}
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
        slotProps={{ paper: personDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={personNameDialog?.mode === 'rename' ? '重命名人物' : '保存为人物'}
          subtitle={personDialogDescriptions[personNameDialog?.mode || 'rename']}
          onClose={() => !personDialogBusy && setPersonNameDialog(null)}
        />
        <Box sx={personDialogScrollSx}>
          <XDriveDialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={personDialogDescriptionSx}>
              {personDialogDescriptions[personNameDialog?.mode || 'rename']}
            </Typography>
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
                  .then(() => {
                    if (personNameDialog?.mode === 'adopt') {
                      restorePersonFocusRef.current = personNameDialog.suggestion?.id || null
                    }
                    setPersonNameDialog(null)
                  })
                  .catch((personError) => {
                    setPersonDialogError(xDriveMediaGalleryErrorMessage(personError))
                  })
                  .finally(() => setPersonDialogBusy(false))
              }}
            >
              保存
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={Boolean(suggestionTargetDialog)}
        onClose={() => !personDialogBusy && setSuggestionTargetDialog(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: personDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="添加到已有人物"
          subtitle={personDialogDescriptions.assign}
          onClose={() => !personDialogBusy && setSuggestionTargetDialog(null)}
        />
        <Box sx={personDialogScrollSx}>
          <XDriveDialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={personDialogDescriptionSx}>
              {personDialogDescriptions.assign}
            </Typography>
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
                        .then(() => {
                          restorePersonFocusRef.current = suggestionTargetDialog.id
                          setSuggestionTargetDialog(null)
                        })
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
        </Box>
      </Dialog>

      <Dialog
        open={mergeDialogOpen}
        onClose={() => !personDialogBusy && setMergeDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: personDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="合并人物"
          subtitle={personDialogDescriptions.merge}
          onClose={() => !personDialogBusy && setMergeDialogOpen(false)}
        />
        <Box sx={personDialogScrollSx}>
          <XDriveDialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={personDialogDescriptionSx}>
              {personDialogDescriptions.merge}
            </Typography>
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
        </Box>
      </Dialog>

      <Dialog
        open={splitDialogOpen}
        onClose={() => !personDialogBusy && setSplitDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: personDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="拆分人物"
          subtitle={personDialogDescriptions.split}
          onClose={() => !personDialogBusy && setSplitDialogOpen(false)}
        />
        <Box sx={personDialogScrollSx}>
          <XDriveDialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={personDialogDescriptionSx}>
              {personDialogDescriptions.split}
            </Typography>
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
                  '@media (max-width:899.95px)': { maxHeight: 'none', overflow: 'visible' },
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
        </Box>
      </Dialog>

    </Stack>
  )
}
