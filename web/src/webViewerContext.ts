import type {
  MediaGalleryDataSource,
} from '@xdrive/ui/mui'
import {
  xDriveClassifyFilePreview,
} from '../../ui/shared/src'
import type {
  MediaItem,
  Node,
  XDriveWebAppBrowseContext,
  XDriveWebAppGalleryTarget,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'

export type XDriveWebViewerCandidate = {
  node: Node
  mediaItem?: MediaItem
  index: number
  totalCount: number
}

export type XDriveWebViewerPredicate = (node: Node) => boolean
export type XDriveWebViewerMediaPatch = Partial<Pick<MediaItem,
  'favorite' | 'tags' | 'people' | 'description' | 'edit_recipe'>>

export const xDriveWebViewerAnyFile: XDriveWebViewerPredicate = (node) => node.type === 'file'

export const xDriveWebViewerMediaFile: XDriveWebViewerPredicate = (node) => {
  const kind = xDriveClassifyFilePreview({
    name: node.name,
    kind: node.type,
  })
  return kind === 'image' || kind === 'video' || kind === 'live_photo'
}

async function loadGalleryRange(
  source: MediaGalleryDataSource,
  target: XDriveWebAppGalleryTarget,
  offset: number,
  limit: number,
) {
  switch (target.kind) {
    case 'trash':
      if (!source.listTrashItemRange) throw new Error('当前客户端不支持图库回收站范围加载。')
      return source.listTrashItemRange(limit, offset)
    case 'person':
      if (!target.id || !source.listPersonItemRange) throw new Error('当前客户端不支持人物图库范围加载。')
      return source.listPersonItemRange(target.id, limit, offset, target.query)
    case 'memory':
      if (!target.id || !source.listMemoryItemRange) throw new Error('当前客户端不支持回忆范围加载。')
      return source.listMemoryItemRange(target.id, limit, offset)
    case 'duplicate-review':
      if (!target.id || !source.listDuplicateItemRange) throw new Error('当前客户端不支持重复项审查范围加载。')
      return source.listDuplicateItemRange(target.id, limit, offset)
    case 'burst-review':
      if (!target.id || !source.listBurstReviewItemRange) throw new Error('当前客户端不支持连拍审查范围加载。')
      return source.listBurstReviewItemRange(target.id, limit, offset)
    case 'pet':
      if (!target.id || !source.listPetItemRange) throw new Error('当前客户端不支持宠物集合范围加载。')
      return source.listPetItemRange(target.id, limit, offset)
    case 'suggested-person':
      if (!target.id || !source.listSuggestedPersonItemRange) throw new Error('当前客户端不支持人物建议范围加载。')
      return source.listSuggestedPersonItemRange(target.id, limit, offset, target.query)
    case 'album':
      if (!target.id) throw new Error('相册 ID 缺失。')
      return source.listAlbumItemRange(target.id, limit, offset, target.query)
    default:
      return source.listItemRange(limit, offset, target.query)
  }
}

async function loadRange(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: Exclude<XDriveWebAppBrowseContext, { kind: 'selection' }>,
  offset: number,
  limit: number,
): Promise<{
  items: Array<{ node: Node; mediaItem?: MediaItem }>
  totalCount: number
}> {
  if (context.kind === 'directory') {
    const page = await api.listRange(
      context.directoryID,
      offset,
      limit,
      context.sort.key,
      context.sort.direction,
      true,
      context.grouping,
    )
    return {
      items: page.items.map((node) => ({ node })),
      totalCount: page.total_count,
    }
  }

  if (context.kind === 'search') {
    const page = await api.searchRange(
      context.query,
      context.filters,
      offset,
      limit,
      context.sort.key,
      context.sort.direction,
      context.grouping,
    )
    return {
      items: page.items.map((item) => ({ node: item.node })),
      totalCount: page.total_count,
    }
  }

  const page = await loadGalleryRange(
    gallerySource,
    context.target,
    offset,
    limit,
  )
  return {
    items: page.items.map((mediaItem) => ({ node: mediaItem.node, mediaItem })),
    totalCount: page.total_count,
  }
}

export async function xDriveResolveWebViewerCandidateAt(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
  index: number,
) {
  return createXDriveWebViewerSession(api, gallerySource, context).candidateAt(index)
}

export async function xDriveFindWebViewerNeighbor(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
  currentIndex: number,
  direction: -1 | 1,
  predicate: XDriveWebViewerPredicate,
) {
  return createXDriveWebViewerSession(api, gallerySource, context).neighbor(currentIndex, direction, predicate)
}

export type XDriveWebViewerContextResolver = {
  resolveCandidateAt: (index: number) => Promise<XDriveWebViewerCandidate | null>
  findNeighbor: (index: number, direction: -1 | 1, predicate: XDriveWebViewerPredicate) => Promise<XDriveWebViewerCandidate | null>
}

export function xDriveCreateWebViewerContextResolver(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
): XDriveWebViewerContextResolver {
  const reader = createXDriveWebViewerSession(api, gallerySource, context)
  return { resolveCandidateAt: reader.candidateAt, findNeighbor: reader.neighbor }
}

// Metadata belongs to one active Viewer step, never a global/sessionStorage media cache.
// Three pages cap range retention at 384 items; new active items receive fresh readers.
export function createXDriveWebViewerSession(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext | null,
  initialCandidate?: XDriveWebViewerCandidate,
) {
  type Page = Awaited<ReturnType<typeof loadRange>>
  type Entry<T> = { promise: Promise<T>; value?: T }
  const pages = new Map<number, Entry<Page>>()
  const nodes = new Map<number, Entry<Node>>()
  const media = new Map<number, Entry<MediaItem>>()
  const acknowledgedPatches = new Map<number, { node: Node; patch: XDriveWebViewerMediaPatch }>()
  const pageSize = 128
  const nodeLimit = 32
  if (initialCandidate) {
    const { node, mediaItem } = initialCandidate
    nodes.set(node.id, { value: node, promise: Promise.resolve(node) })
    if (mediaItem) media.set(node.id, { value: mediaItem, promise: Promise.resolve(mediaItem) })
  }

  function read<K, T>(cache: Map<K, Entry<T>>, key: K, limit: number, loader: () => Promise<T>) {
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached.promise
    }
    const entry: Entry<T> = { promise: Promise.resolve().then(loader) }
    cache.set(key, entry)
    while (cache.size > limit) cache.delete(cache.keys().next().value!)
    entry.promise = entry.promise.then((value) => {
      entry.value = value
      return value
    }, (reason) => {
      if (cache.get(key) === entry) cache.delete(key)
      throw reason
    })
    return entry.promise
  }

  const pageAt = (offset: number) => {
    if (!context || context.kind === 'selection') throw new Error('没有范围浏览上下文。')
    return read(pages, offset, 3, () => loadRange(api, gallerySource, context, offset, pageSize))
  }
  const nodeAt = (id: number) => read(nodes, id, nodeLimit, () => api.node(id))
  const mediaAt = (id: number) => read(media, id, nodeLimit, () => api.mediaItem(id))
  const sameSource = (a: Node, b: Node) => a.id === b.id && a.revision === b.revision &&
    (!a.sha256 || !b.sha256 || a.sha256 === b.sha256)
  const withAcknowledgedPatch = (item: MediaItem) => {
    const acknowledged = acknowledgedPatches.get(item.node.id)
    return acknowledged && sameSource(acknowledged.node, item.node) ? { ...item, ...acknowledged.patch } : item
  }
  function remember<T>(cache: Map<number, Entry<T>>, id: number, value: T) {
    cache.delete(id)
    cache.set(id, { value, promise: Promise.resolve(value) })
    while (cache.size > nodeLimit) cache.delete(cache.keys().next().value!)
  }

  async function candidateAt(index: number): Promise<XDriveWebViewerCandidate | null> {
    if (!context || !Number.isInteger(index) || index < 0) return null
    if (context.kind === 'selection') {
      const id = context.nodeIDs[index]
      if (id === undefined) return null
      return { node: await nodeAt(id), index, totalCount: context.nodeIDs.length }
    }
    const offset = Math.floor(index / pageSize) * pageSize
    const page = await pageAt(offset)
    const item = page.items[index - offset]
    return item ? { ...item, mediaItem: item.mediaItem ? withAcknowledgedPatch(item.mediaItem) : undefined,
      index, totalCount: page.totalCount } : null
  }

  async function neighbor(index: number, direction: -1 | 1, predicate: XDriveWebViewerPredicate) {
    if (!context) return null
    if (context.kind === 'selection') {
      for (let cursor = index + direction; cursor >= 0 && cursor < context.nodeIDs.length; cursor += direction) {
        const candidate = await candidateAt(cursor)
        if (candidate && predicate(candidate.node)) return candidate
      }
      return null
    }
    let cursor = index + direction
    while (cursor >= 0) {
      const offset = Math.floor(cursor / pageSize) * pageSize
      const page = await pageAt(offset)
      if (cursor >= page.totalCount) {
        if (direction > 0) return null
        cursor = page.totalCount - 1
        continue
      }
      const end = Math.min(page.totalCount - 1, offset + page.items.length - 1)
      for (let i = direction > 0 ? cursor : Math.min(cursor, end);
        direction > 0 ? i <= end : i >= offset; i += direction) {
        const item = page.items[i - offset]
        if (item && predicate(item.node)) return { ...item,
          mediaItem: item.mediaItem ? withAcknowledgedPatch(item.mediaItem) : undefined,
          index: i, totalCount: page.totalCount }
      }
      cursor = direction > 0 ? offset + pageSize : offset - 1
      if (direction > 0 && cursor >= page.totalCount) return null
    }
    return null
  }

  async function current(nodeID: number, index: number, wantsMedia = false, expectedNode?: Node) {
    const candidate = await candidateAt(index).catch(() => null)
    const usable = candidate?.node.id === nodeID && (!expectedNode || sameSource(candidate.node, expectedNode))
    if (!usable && expectedNode) {
      const cached = nodes.get(nodeID)?.value ?? media.get(nodeID)?.value?.node
      if (cached && !sameSource(cached, expectedNode)) {
        nodes.delete(nodeID)
        media.delete(nodeID)
      }
    }
    let mediaItem = wantsMedia && usable ? candidate.mediaItem : undefined
    if (wantsMedia && !mediaItem) mediaItem = await mediaAt(nodeID)
    const node = usable ? candidate.node : mediaItem?.node ?? await nodeAt(nodeID)
    if (node.id !== nodeID || (expectedNode && !sameSource(node, expectedNode))) {
      invalidate(nodeID)
      throw new Error('文件版本已更改，请重新打开。')
    }
    if (mediaItem && !sameSource(mediaItem.node, node)) {
      invalidate(nodeID)
      throw new Error('媒体信息与当前文件版本不一致，请重试。')
    }
    remember(nodes, nodeID, node)
    if (mediaItem) {
      mediaItem = withAcknowledgedPatch(mediaItem)
      remember(media, nodeID, mediaItem)
    }
    const totalCount = candidate?.totalCount ?? (context?.kind === 'selection'
      ? context.nodeIDs.length : context?.kind === 'gallery'
        ? context.totalCount : context ? 0 : 1)
    return { node, mediaItem, index, totalCount }
  }

  function invalidate(nodeID?: number) {
    if (nodeID === undefined) {
      pages.clear(); nodes.clear(); media.clear(); acknowledgedPatches.clear()
      return
    }
    nodes.delete(nodeID)
    media.delete(nodeID)
    acknowledgedPatches.delete(nodeID)
    for (const [offset, entry] of pages) {
      if (!entry.value || entry.value.items.some((item) => item.node.id === nodeID)) pages.delete(offset)
    }
  }

  function updateMediaItem(item: MediaItem, patch?: XDriveWebViewerMediaPatch) {
    const knownNodes = [nodes.get(item.node.id)?.value, media.get(item.node.id)?.value?.node,
      ...Array.from(pages.values()).flatMap((entry) => entry.value?.items
        .filter((candidate) => candidate.node.id === item.node.id).map((candidate) => candidate.node) ?? [])]
    if (knownNodes.some((known) => known && (known.revision > item.node.revision ||
      (known.revision === item.node.revision && !sameSource(known, item.node))))) return null
    const latestPage = Array.from(pages.values()).flatMap((entry) => entry.value?.items ?? [])
      .find((candidate) => sameSource(candidate.node, item.node))?.mediaItem
    const cached = media.get(item.node.id)?.value
    const latest = latestPage ? withAcknowledgedPatch(latestPage)
      : cached && sameSource(cached.node, item.node) ? cached : item
    const updated = patch ? { ...(latest ?? item), ...patch, node: item.node } : item
    const previousPatch = acknowledgedPatches.get(item.node.id)
    acknowledgedPatches.delete(item.node.id)
    acknowledgedPatches.set(item.node.id, { node: item.node, patch: {
      ...(previousPatch && sameSource(previousPatch.node, item.node) ? previousPatch.patch : {}),
      ...(patch ?? { favorite: item.favorite, tags: item.tags, people: item.people,
        description: item.description, edit_recipe: item.edit_recipe }),
    } })
    while (acknowledgedPatches.size > nodeLimit) acknowledgedPatches.delete(acknowledgedPatches.keys().next().value!)
    for (const [offset, entry] of pages) {
      if (!entry.value) continue
      const matches = entry.value.items.filter((candidate) => candidate.node.id === item.node.id)
      if (matches.some((candidate) => !sameSource(candidate.node, item.node))) {
        pages.delete(offset)
        continue
      }
      entry.value.items = entry.value.items.map((candidate) => candidate.node.id === item.node.id
        ? { node: item.node, mediaItem: updated } : candidate)
    }
    remember(nodes, item.node.id, item.node)
    remember(media, item.node.id, updated)
    return updated
  }

  return { candidateAt, neighbor, current, updateMediaItem, invalidate }
}
