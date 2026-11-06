import type { MediaItem, Node } from './models'

export function validPhotoContentKey(value: unknown): value is string {
  return typeof value === 'string' && /^(?:sha256:|photo-bundle:v1:sha256:)[a-f0-9]{64}$/.test(value)
}

/** File revision remains the byte-delivery locator; this is the Gallery identity. */
export function photoContentIdentity(item: MediaItem): string {
  if (item.content_key !== undefined && !validPhotoContentKey(item.content_key)) {
    throw new Error('照片原件标识无效，请刷新图库')
  }
  return item.content_key ?? `legacy:${item.node.id}:${item.node.revision}`
}

export function photoContentKeys(items: readonly MediaItem[]): string[] | undefined {
  if (items.every(item => item.content_key === undefined)) return undefined
  if (!items.every(item => validPhotoContentKey(item.content_key))) {
    throw new Error('部分照片仍在核验原件，请完成后再批量操作')
  }
  return items.map(item => item.content_key!)
}

export function photoContentPath(nodeID: number, contentKey?: string): string {
  if (contentKey !== undefined) {
    if (!validPhotoContentKey(contentKey)) throw new Error('照片原件标识无效')
    return `/api/v1/media/content/${encodeURIComponent(contentKey)}`
  }
  if (!Number.isSafeInteger(nodeID) || nodeID <= 0) throw new Error('照片文件标识无效')
  return `/api/v1/media/items/${nodeID}`
}

export function photoContentSelection(nodeIDs: number[], contentKeys?: string[]) {
  if (contentKeys !== undefined) {
    if (contentKeys.length === 0 || contentKeys.length > 1000 || !contentKeys.every(validPhotoContentKey)) {
      throw new Error('照片原件选择无效')
    }
    return { content_keys: contentKeys }
  }
  return { node_ids: nodeIDs }
}

export interface PhotoContentSources { content_key: string; items: Node[]; next_cursor?: number }
