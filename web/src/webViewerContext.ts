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

type XDriveWebViewerRangePage = {
  items: Array<{ node: Node; mediaItem?: MediaItem }>
  totalCount: number
}

export type XDriveWebViewerPredicate = (node: Node) => boolean

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
): Promise<XDriveWebViewerRangePage> {
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

export type XDriveWebViewerContextResolver = {
  resolveCandidateAt: (index: number) => Promise<XDriveWebViewerCandidate | null>
  findNeighbor: (
    currentIndex: number,
    direction: -1 | 1,
    predicate: XDriveWebViewerPredicate,
  ) => Promise<XDriveWebViewerCandidate | null>
}

export function xDriveCreateWebViewerContextResolver(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
): XDriveWebViewerContextResolver {
  const pageSize = 128
  const pageLimit = 4
  const pagePromises = new Map<number, Promise<XDriveWebViewerRangePage>>()
  const pageOrder: number[] = []

  const touchPage = (offset: number) => {
    const index = pageOrder.indexOf(offset)
    if (index >= 0) pageOrder.splice(index, 1)
    pageOrder.push(offset)
    while (pageOrder.length > pageLimit) {
      const evicted = pageOrder.shift()
      if (evicted !== undefined) pagePromises.delete(evicted)
    }
  }

  const loadPage = (offset: number) => {
    const cached = pagePromises.get(offset)
    if (cached) {
      touchPage(offset)
      return cached
    }
    let request: Promise<XDriveWebViewerRangePage>
    request = loadRange(api, gallerySource, context as Exclude<XDriveWebAppBrowseContext, { kind: 'selection' }>, offset, pageSize)
      .catch((error) => {
        if (pagePromises.get(offset) === request) {
          pagePromises.delete(offset)
          const index = pageOrder.indexOf(offset)
          if (index >= 0) pageOrder.splice(index, 1)
        }
        throw error
      })
    pagePromises.set(offset, request)
    touchPage(offset)
    return request
  }

  const resolveCandidateAt = async (index: number) => {
    if (index < 0) return null
    if (context.kind === 'selection') {
      if (index >= context.nodeIDs.length) return null
      const node = await api.node(context.nodeIDs[index])
      return {
        node,
        index,
        totalCount: context.nodeIDs.length,
      } satisfies XDriveWebViewerCandidate
    }

    const offset = Math.floor(index / pageSize) * pageSize
    const page = await loadPage(offset)
    const item = page.items[index - offset]
    if (!item) return null
    return {
      ...item,
      index,
      totalCount: page.totalCount,
    } satisfies XDriveWebViewerCandidate
  }

  const findNeighbor = async (
    currentIndex: number,
    direction: -1 | 1,
    predicate: XDriveWebViewerPredicate,
  ) => {
    if (context.kind === 'selection') {
      for (
        let index = currentIndex + direction;
        index >= 0 && index < context.nodeIDs.length;
        index += direction
      ) {
        const node = await api.node(context.nodeIDs[index])
        if (!predicate(node)) continue
        return {
          node,
          index,
          totalCount: context.nodeIDs.length,
        } satisfies XDriveWebViewerCandidate
      }
      return null
    }

    let cursor = currentIndex + direction
    while (cursor >= 0) {
      const offset = Math.floor(cursor / pageSize) * pageSize
      const page = await loadPage(offset)
      if (cursor >= page.totalCount) {
        if (direction > 0) return null
        cursor = page.totalCount - 1
        if (cursor < 0) return null
        continue
      }

      const pageEnd = Math.min(page.totalCount - 1, offset + page.items.length - 1)
      if (direction > 0) {
        for (let index = Math.max(cursor, offset); index <= pageEnd; index += 1) {
          const item = page.items[index - offset]
          if (item && predicate(item.node)) {
            return {
              ...item,
              index,
              totalCount: page.totalCount,
            } satisfies XDriveWebViewerCandidate
          }
        }
        cursor = pageEnd + 1
        if (cursor >= page.totalCount) return null
      } else {
        for (let index = Math.min(cursor, pageEnd); index >= offset; index -= 1) {
          const item = page.items[index - offset]
          if (item && predicate(item.node)) {
            return {
              ...item,
              index,
              totalCount: page.totalCount,
            } satisfies XDriveWebViewerCandidate
          }
        }
        cursor = offset - 1
      }
    }
    return null
  }

  return { resolveCandidateAt, findNeighbor }
}

export async function xDriveResolveWebViewerCandidateAt(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
  index: number,
) {
  return xDriveCreateWebViewerContextResolver(api, gallerySource, context)
    .resolveCandidateAt(index)
}

export async function xDriveFindWebViewerNeighbor(
  api: XDriveApi,
  gallerySource: MediaGalleryDataSource,
  context: XDriveWebAppBrowseContext,
  currentIndex: number,
  direction: -1 | 1,
  predicate: XDriveWebViewerPredicate,
) {
  return xDriveCreateWebViewerContextResolver(api, gallerySource, context)
    .findNeighbor(currentIndex, direction, predicate)
}
