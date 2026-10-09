import type { MediaItem } from './models'

/**
 * Select only original, owner-scoped Nodes in the canonical PhotoAsset resources.
 * The Server archive endpoint independently rechecks ownership and availability.
 * Do not guess an Apple Live Photo pair by name or timestamp.
 */
export function xDriveCompleteLivePhotoOriginalNodeIDs(item: MediaItem): number[] {
  if (!item.live_photo && item.asset_kind !== 'live_photo') {
    throw new Error('此媒体不是实况照片')
  }
  const primaryID = item.node.id
  if (!Number.isSafeInteger(primaryID) || primaryID <= 0) {
    throw new Error('实况照片原始资源不可用')
  }
  // A validated .livp is already one complete canonical original container.
  // Its derived still/motion byte ranges must never be treated as extra Nodes.
  if (item.node.name.trim().toLowerCase().endsWith('.livp')) {
    return [primaryID]
  }

  const originals = (item.resources ?? []).filter((resource) => (
    resource.kind === 'node' &&
    Number.isSafeInteger(resource.node_id) &&
    resource.node_id > 0
  ))
  const still = originals.filter((resource) => (
    resource.role === 'still' && resource.media_kind === 'image'
  ))
  const motion = originals.filter((resource) => (
    resource.role === 'motion' && resource.media_kind === 'video'
  ))
  if (
    still.length !== 1 ||
    motion.length !== 1 ||
    still[0].node_id !== primaryID ||
    motion[0].node_id === primaryID
  ) {
    throw new Error('缺少可靠的静态照片与动态视频配对，无法导出完整实况')
  }
  return [still[0].node_id, motion[0].node_id]
}
