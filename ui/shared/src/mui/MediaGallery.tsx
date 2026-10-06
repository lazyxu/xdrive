import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowBack as ArrowBackIcon,
  Collections as CollectionsIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  PlayCircleOutline as LivePhotoIcon,
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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type {
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaItemRange,
  MediaPersonIdentity,
  MediaPersonSplit,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  MediaTimelineGroupIndex,
  UpdateMediaPersonIdentityInput,
} from '../models'
import { XDriveDialogContent } from './DialogContent'
import {
  XDriveMediaGalleryFilterBar,
  emptyMediaGalleryFilterDraft,
  hasMediaGalleryFilters,
  mediaGalleryDraftFromQuery,
  mediaGalleryQueryFromDraft,
} from './MediaGalleryFilters'
import type { MediaGalleryFilterDraft } from './MediaGalleryFilters'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveMediaDetailsDialog } from './MediaGalleryDetails'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'
import { XDriveOpenPreviewDialog } from './FileOpenPreviewDialog'
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
export type MediaMotionLoader = (nodeID: number) => Promise<string | null>
export type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video',
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
  listAlbums: () => Promise<MediaAlbum[]>
  listPlaces?: (limit?: number) => Promise<MediaPlaceFacet[]>
  listSuggestedPeople?: (limit?: number) => Promise<MediaSuggestedPerson[]>
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
  setTags?: (nodeID: number, tags: string[]) => Promise<string[]>
  setPeople?: (nodeID: number, people: string[]) => Promise<string[]>
  setDescription?: (nodeID: number, description: string) => Promise<string>
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

type MediaGalleryCollectionTarget = {
  kind: 'all' | 'album' | 'suggested-person' | 'person'
  id?: string
  query: MediaGalleryQuery
  requestID: number
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

export interface XDriveMediaGalleryPageProps {
  source: MediaGalleryDataSource
  pageSize?: number
  onError?: (error: unknown) => void
}

export function XDriveMediaGalleryPage({
  source,
  pageSize = 100,
  onError,
}: XDriveMediaGalleryPageProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([])
  const [places, setPlaces] = useState<MediaPlaceFacet[]>([])
  const [suggestedPeople, setSuggestedPeople] = useState<MediaSuggestedPerson[]>([])
  const [people, setPersonIdentities] = useState<MediaPersonIdentity[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [timelineGroups, setTimelineGroups] = useState<MediaTimelineGroupIndex[]>([])
  const [currentAlbum, setCurrentAlbum] = useState<MediaAlbum | null>(null)
  const [currentSuggestedPerson, setCurrentSuggestedPerson] =
    useState<MediaSuggestedPerson | null>(null)
  const [currentPerson, setCurrentPerson] = useState<MediaPersonIdentity | null>(null)
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
  const requestID = useRef(0)
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
      case 'person':
        if (!target.id || !source.listPersonItemRange) {
          throw new Error('当前客户端不支持人物图库范围加载')
        }
        return source.listPersonItemRange(target.id, limit, offset, target.query)
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
      setTimelineGroups(page.timeline_groups ?? [])
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
  ) => {
    const request = ++requestID.current
    const target = mediaGalleryTarget(
      request,
      album,
      nextQuery,
      suggestedPerson,
      person,
    )
    collectionTargetRef.current = target
    setCollectionTarget(target)
    setTimelineGroups([])
    virtualCollection.reset(mediaGalleryCollectionKey(target))
    setLoading(true)
    setError('')
    try {
      const rangePromise = loadTargetRange(target, 0, pageSize)
      if (target.kind === 'all') {
        const [range, nextAlbums, nextPlaces, nextSuggestedPeople, nextPeople] = await Promise.all([
          rangePromise,
          source.listAlbums(),
          source.listPlaces ? source.listPlaces(24) : Promise.resolve([]),
          source.listSuggestedPeople ? source.listSuggestedPeople(24) : Promise.resolve([]),
          listAllPeople(),
        ])
        if (
          request !== requestID.current ||
          collectionTargetRef.current?.requestID !== request
        ) return
        setCurrentAlbum(null)
        setCurrentSuggestedPerson(null)
        setCurrentPerson(null)
        setAlbums(nextAlbums)
        setPlaces(nextPlaces)
        setSuggestedPeople(nextSuggestedPeople)
        setPersonIdentities(nextPeople)
        setItems([...range.items])
        setTimelineGroups(range.timeline_groups ?? [])
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
      setItems([...range.items])
      setTimelineGroups(range.timeline_groups ?? [])
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
    const nextDraft = currentPerson
      ? { ...emptyMediaGalleryFilterDraft, personIdentity: currentPerson.id }
      : emptyMediaGalleryFilterDraft
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setDraftFilters(nextDraft)
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery, currentSuggestedPerson, currentPerson)
  }, [currentAlbum, currentPerson, currentSuggestedPerson, loadFirstPage])

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

  const openAlbum = useCallback((album: MediaAlbum) => {
    if (album.kind === 'smart') {
      setDraftFilters(mediaGalleryDraftFromQuery(album.query))
      setQuery({})
      void loadFirstPage(album, {})
      return
    }
    void loadFirstPage(album, query)
  }, [loadFirstPage, query])

  const openPlace = useCallback((place: MediaPlaceFacet) => {
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

  const openSuggestedPerson = useCallback((person: MediaSuggestedPerson) => {
    setQuery({})
    setDraftFilters(emptyMediaGalleryFilterDraft)
    void loadFirstPage(null, {}, person, null)
  }, [loadFirstPage])

  const openPerson = useCallback((person: MediaPersonIdentity) => {
    const nextDraft = {
      ...emptyMediaGalleryFilterDraft,
      personIdentity: person.id,
    }
    const nextQuery = mediaGalleryQueryFromDraft(nextDraft)
    setQuery(nextQuery)
    setDraftFilters(nextDraft)
    void loadFirstPage(null, nextQuery, null, person)
  }, [loadFirstPage])

  const leaveAlbum = useCallback(() => {
    if (currentAlbum?.kind === 'smart' || currentSuggestedPerson || currentPerson) {
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      void loadFirstPage(null, {})
      return
    }
    void loadFirstPage(null, query)
  }, [currentAlbum?.kind, currentPerson, currentSuggestedPerson, loadFirstPage, query])

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

  useEffect(() => {
    void loadFirstPage(null, {})
    return () => {
      requestID.current += 1
    }
  }, [loadFirstPage])

  return (
    <XDriveWorkspaceSurface presentation="page" title="图库">
      <XDriveMediaGallery
        items={items}
        virtualCollection={galleryVirtualCollection}
        albums={albums}
        places={places}
        suggestedPeople={suggestedPeople}
        people={people}
        activePlaceID={query.place}
        currentAlbum={currentAlbum}
        currentSuggestedPerson={currentSuggestedPerson}
        currentPerson={currentPerson}
        loading={loading}
        timelineGroups={timelineGroups}
        error={error}
        filters={(
          <XDriveMediaGalleryFilterBar
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
        onSetTags={source.setTags ? setTags : undefined}
        onSetPeople={source.setPeople ? setPeople : undefined}
        onSetDescription={source.setDescription ? setDescription : undefined}
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
        onOpenAlbum={openAlbum}
        onOpenPlace={openPlace}
        onOpenSuggestedPerson={openSuggestedPerson}
        onOpenPerson={openPerson}
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
        onBack={leaveAlbum}
        onRefresh={() => void loadFirstPage(
          currentAlbum,
          query,
          currentSuggestedPerson,
          currentPerson,
        )}
      />
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
  albums?: MediaAlbum[]
  places?: MediaPlaceFacet[]
  suggestedPeople?: MediaSuggestedPerson[]
  people?: MediaPersonIdentity[]
  activePlaceID?: string
  currentAlbum?: MediaAlbum | null
  currentSuggestedPerson?: MediaSuggestedPerson | null
  currentPerson?: MediaPersonIdentity | null
  loading?: boolean
  timelineGroups?: MediaTimelineGroupIndex[]
  error?: string
  filters?: ReactNode
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetTags?: (item: MediaItem, tags: string[]) => Promise<string[]>
  onSetPeople?: (item: MediaItem, people: string[]) => Promise<string[]>
  onSetDescription?: (item: MediaItem, description: string) => Promise<string>
  onCreateAlbum?: (name: string) => Promise<MediaAlbum>
  onRenameAlbum?: (album: MediaAlbum, name: string) => Promise<MediaAlbum>
  onDeleteAlbum?: (album: MediaAlbum) => Promise<void>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onOpenAlbum?: (album: MediaAlbum) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenSuggestedPerson?: (person: MediaSuggestedPerson) => void
  onOpenPerson?: (person: MediaPersonIdentity) => void
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

type MediaGalleryViewMode = 'grid' | 'timeline'

type MediaTimelineGroup = {
  key: string
  label: string
  items: MediaItem[]
}

function mediaTimelineDate(item: MediaItem) {
  if (!item.metadata.captured_at) return null
  const captured = new Date(item.metadata.captured_at)
  return Number.isNaN(captured.getTime()) ? null : captured
}

function mediaTimelineGroups(items: MediaItem[]): MediaTimelineGroup[] {
  const groups = new Map<string, MediaTimelineGroup>()
  const unknown: MediaItem[] = []
  for (const item of items) {
    const date = mediaTimelineDate(item)
    if (!date) {
      unknown.push(item)
      continue
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      continue
    }
    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
      }).format(date),
      items: [item],
    })
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key))
  if (unknown.length > 0) {
    ordered.push({ key: 'unknown', label: '日期未知', items: unknown })
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

type MediaTileProps = {
  item: MediaItem
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
      onClick={openDetails}
      onDoubleClick={(event) => {
        event.preventDefault()
        openPreview()
      }}
      onKeyDown={(event) => keyboardActivate(event, () => onOpen(item))}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        bgcolor: 'action.hover',
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
              left: 8,
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
        icon={livePhoto ? <LivePhotoIcon /> : video ? <MovieIcon /> : <ImageIcon />}
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
  loadThumbnail,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  onOpen,
  onPreview,
  onToggleFavorite,
}: {
  items: MediaItem[]
  loadThumbnail: MediaThumbnailLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 1,
      }}
    >
      {items.map((item) => (
        <MediaTile
          key={item.node.id}
          item={item}
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
  loadThumbnail,
  thumbnailScheduler,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  onOpen,
  onPreview,
  onToggleFavorite,
}: {
  collection: XDriveMediaGalleryVirtualCollection
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
  const [layout, setLayout] = useState(() => ({
    metrics: xDriveMediaGalleryGridMetrics({
      width: 0,
      itemCount: collection.itemCount,
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
  }, [collection.itemCount, collection.onRangeChange])

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
  loadThumbnail,
  thumbnailScheduler,
  loadPreviewURL,
  onSetFavorite,
  onSetCover,
  onOpen,
  onPreview,
  onToggleFavorite,
}: {
  groups: MediaTimelineGroupIndex[]
  collection: XDriveMediaGalleryVirtualCollection
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
    const layout = xDriveMediaGalleryTimelineLayout({ width: 0, groups })
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
  }, [collection.onRangeChange, groups])

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
  albums = [],
  places = [],
  suggestedPeople = [],
  people = [],
  activePlaceID,
  currentAlbum = null,
  currentSuggestedPerson = null,
  currentPerson = null,
  loading = false,
  timelineGroups = [],
  error = '',
  filters,
  loadThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  onSetFavorite,
  onSetTags,
  onSetPeople,
  onSetDescription,
  onCreateAlbum,
  onRenameAlbum,
  onDeleteAlbum,
  onAddToAlbum,
  onRemoveFromAlbum,
  onOpenAlbum,
  onOpenPlace,
  onOpenSuggestedPerson,
  onOpenPerson,
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
  const [viewMode, setViewMode] = useState<MediaGalleryViewMode>('grid')
  const [albumDialog, setAlbumDialog] = useState<{ mode: 'create' | 'rename'; album?: MediaAlbum } | null>(null)
  const [albumName, setAlbumName] = useState('')
  const [albumDialogBusy, setAlbumDialogBusy] = useState(false)
  const [albumDialogError, setAlbumDialogError] = useState('')
  const [deleteAlbumOpen, setDeleteAlbumOpen] = useState(false)

  const [showHiddenPeople, setShowHiddenPeople] = useState(false)
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
  }, [onSetFavorite])

  const denseTimelineGroups = useMemo(() => mediaTimelineGroups(items), [items])
  const logicalItemCount = virtualCollection?.itemCount ?? items.length
  const openMediaItem = useCallback((item: MediaItem) => setSelected(item), [])
  const openMediaPreview = useCallback((item: MediaItem, index?: number) => {
    setPreviewItem(item)
    setPreviewLogicalIndex(index ?? null)
    setPendingPreviewIndex(null)
  }, [])
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
  const previewLivePhoto = Boolean(previewItem?.live_photo || previewItem?.asset_kind === 'live_photo')
  const previewTarget = useMemo(() => (
    previewItem
      ? {
          id: previewItem.node.id,
          name: previewItem.node.name,
          kind: 'file' as const,
          mimeType: previewItem.metadata.mime_type,
          size: previewItem.node.size,
          revision: previewItem.node.revision,
        }
      : null
  ), [
    previewItem?.node.id,
    previewItem?.node.name,
    previewItem?.node.revision,
    previewItem?.node.size,
    previewItem?.metadata.mime_type,
  ])
  const loadOpenPreview = useCallback<XDriveFilePreviewURLLoader>(async (_target, kind) => {
    if (!previewItem || !loadPreviewURL || (kind !== 'image' && kind !== 'video')) return null
    return loadPreviewURL(previewItem.node.id, kind)
  }, [loadPreviewURL, previewItem?.node.id])
  const loadOpenThumbnail = useCallback<XDriveFilePreviewImageLoader>(async () => {
    if (!previewItem?.metadata.has_thumbnail) return null
    return loadThumbnail(previewItem.node.id)
  }, [loadThumbnail, previewItem?.metadata.has_thumbnail, previewItem?.node.id])
  const loadOpenLivePhotoMotion = useCallback(async () => {
    if (!previewItem || !loadLivePhotoMotion) return null
    return loadLivePhotoMotion(previewItem.node.id)
  }, [loadLivePhotoMotion, previewItem?.node.id])

  const toggleMediaFavorite = useCallback((item: MediaItem) => {
    void toggleFavorite(item).catch(() => undefined)
  }, [toggleFavorite])

  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {(currentAlbum || currentSuggestedPerson || currentPerson) && onBack ? (
          <Tooltip title="返回全部图库">
            <IconButton onClick={onBack} size="small" aria-label="返回全部图库">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={700} noWrap>
            {currentAlbum?.name ||
              (currentPerson
                ? currentPerson.name || '未命名人物'
                : currentSuggestedPerson
                  ? '人物建议'
                  : '图库')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {currentAlbum
              ? `${currentAlbum.item_count.toLocaleString('zh-CN')} 个项目`
              : currentPerson
                ? `${currentPerson.item_count.toLocaleString('zh-CN')} 张照片 · 长期人物${currentPerson.hidden ? ' · 已隐藏' : ''}`
                : currentSuggestedPerson
                  ? `${currentSuggestedPerson.item_count.toLocaleString('zh-CN')} 张照片 · 自动聚类建议`
                  : '所有 xDrive 图片和视频，包括普通上传和同步文件夹文件'}
          </Typography>
        </Box>
        {!currentAlbum && !currentSuggestedPerson && !currentPerson && onCreateAlbum ? (
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
        <Stack direction="row" spacing={0.5} aria-label="图库视图">
          <Button
            size="small"
            variant={viewMode === 'grid' ? 'contained' : 'text'}
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          >
            网格
          </Button>
          <Button
            size="small"
            variant={viewMode === 'timeline' ? 'contained' : 'text'}
            aria-pressed={viewMode === 'timeline'}
            onClick={() => setViewMode('timeline')}
          >
            时间轴
          </Button>
        </Stack>
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

      {filters}

      {error ? (
        <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
      ) : null}

      {!currentAlbum && !currentSuggestedPerson && !currentPerson && albums.length > 0 ? (
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

      {!currentAlbum && !currentSuggestedPerson && !currentPerson && places.length > 0 ? (
        <Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.75}
            alignItems={{ xs: 'flex-start', sm: 'baseline' }}
            sx={{ mb: 1.25 }}
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
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
          >
            {places.map((place) => (
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
      ) : null}

      {!currentAlbum && !currentSuggestedPerson && !currentPerson && people.length > 0 ? (
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
                人物
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

      {!currentAlbum && !currentSuggestedPerson && !currentPerson && suggestedPeople.length > 0 ? (
        <Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.75}
            alignItems={{ xs: 'flex-start', sm: 'baseline' }}
            sx={{ mb: 1.25 }}
          >
            <Typography variant="subtitle1" fontWeight={700}>
              人物建议
            </Typography>
            <Typography variant="caption" color="text.secondary">
              由本地人脸分析自动聚类；尚未写入手工人物标签
            </Typography>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {suggestedPeople.map((person) => (
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
                  <Typography variant="body2" fontWeight={650} noWrap>
                    未命名人物
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {person.item_count.toLocaleString('zh-CN')} 张照片
                    {person.face_count !== person.item_count
                      ? ` · ${person.face_count.toLocaleString('zh-CN')} 张脸`
                      : ''}
                  </Typography>
                  {onAdoptSuggestedPerson ? (
                    <Button
                      size="small"
                      variant="text"
                      sx={{ mt: 0.5, px: 0 }}
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
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      <Box>
        {!currentAlbum && !currentSuggestedPerson && !currentPerson ? (
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
                没有可显示的图片或视频
              </Typography>
            </Stack>
          </Paper>
        ) : viewMode === 'timeline' ? (
          virtualCollection ? (
            <MediaVirtualTimeline
              groups={timelineGroups}
              collection={virtualCollection}
              loadThumbnail={loadThumbnail}
              thumbnailScheduler={thumbnailScheduler}
              loadPreviewURL={loadPreviewURL}
              onSetFavorite={onSetFavorite}
              onSetCover={
                currentPerson && onSetPersonCover
                  ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                  : undefined
              }
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
                    loadThumbnail={loadThumbnail}
                    loadPreviewURL={loadPreviewURL}
                    onSetFavorite={onSetFavorite}
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
            loadThumbnail={loadThumbnail}
            thumbnailScheduler={thumbnailScheduler}
            loadPreviewURL={loadPreviewURL}
            onSetFavorite={onSetFavorite}
            onSetCover={
              currentPerson && onSetPersonCover
                ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                : undefined
            }
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
          />
        ) : (
          <MediaTileGrid
            items={items}
            loadThumbnail={loadThumbnail}
            loadPreviewURL={loadPreviewURL}
            onSetFavorite={onSetFavorite}
            onSetCover={
              currentPerson && onSetPersonCover
                ? (item) => { void onSetPersonCover(currentPerson, item).catch(() => undefined) }
                : undefined
            }
            onOpen={openMediaItem}
            onPreview={openMediaPreview}
            onToggleFavorite={toggleMediaFavorite}
          />
        )}
      </Box>

      <XDriveOpenPreviewDialog
        open={Boolean(previewItem)}
        title={previewItem?.node.name ?? ''}
        positionLabel={previewIndex >= 0 ? `${previewIndex + 1} / ${logicalItemCount}` : undefined}
        canPrevious={previewIndex > 0}
        canNext={previewIndex >= 0 && previewIndex < logicalItemCount - 1}
        onPrevious={() => requestPreviewIndex(previewIndex - 1)}
        onNext={() => requestPreviewIndex(previewIndex + 1)}
        onClose={() => {
          setPreviewItem(null)
          setPreviewLogicalIndex(null)
          setPendingPreviewIndex(null)
        }}
      >
        {previewItem ? (
          previewLivePhoto && loadLivePhotoMotion ? (
            <XDriveLivePhotoSurface
              key={previewItem.node.id}
              label={previewItem.node.name}
              loadMotion={loadOpenLivePhotoMotion}
              still={(
                <XDriveFilePreviewSurface
                  target={previewTarget}
                  loadPreviewURL={loadOpenPreview}
                  loadImagePreview={loadOpenThumbnail}
                  fallback={xDriveMediaFallback(previewItem.metadata.media_kind)}
                  minHeight={320}
                  maxHeight={760}
                />
              )}
            />
          ) : (
            <XDriveFilePreviewSurface
              target={previewTarget}
              loadPreviewURL={loadOpenPreview}
              loadImagePreview={loadOpenThumbnail}
              fallback={xDriveMediaFallback(previewItem.metadata.media_kind)}
              minHeight={320}
              maxHeight={760}
            />
          )
        ) : null}
      </XDriveOpenPreviewDialog>

      <XDriveMediaDetailsDialog
        item={selected}
        loadThumbnail={loadThumbnail}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPreviewURL={loadPreviewURL}
        albums={albums}
        currentAlbum={currentAlbum}
        onAddToAlbum={onAddToAlbum}
        onRemoveFromAlbum={onRemoveFromAlbum}
        onSetFavorite={onSetFavorite ? async (item, favorite) => {
          await onSetFavorite(item, favorite)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, favorite }
              : current
          ))
        } : undefined}
        onSetTags={onSetTags ? async (item, tags) => {
          const normalized = await onSetTags(item, tags)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, tags: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onSetPeople={onSetPeople ? async (item, people) => {
          const normalized = await onSetPeople(item, people)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, people: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onSetDescription={onSetDescription ? async (item, description) => {
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
