import type { XDriveOverviewPort, XDriveFileExplorerItem } from '@xdrive/ui/mui'
import { xDriveCaptureVideoPosterBlob, xDriveFileKind, xDriveResolveMediaVideoPoster } from '@xdrive/ui/mui'
import { xDriveDesktopViewportRequest } from './abortableViewportRequest'

// Only the Electron Host owns IPC, signed media URLs and native file opening.
// The canonical Home view lives entirely in ui/shared.
const loadThumbnail = async (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (item.kind !== 'file' || signal?.aborted) return null
    const nodeID = Number(item.id)
    const agent = window.xdriveDesktop.agent
    const loadCached = async (id: number, requestSignal?: AbortSignal) => {
      const result = await xDriveDesktopViewportRequest(
        requestSignal,
        (requestID) => agent.getMediaThumbnail(id, requestID),
      )
      if (!result.ok || requestSignal?.aborted) return null
      return URL.createObjectURL(new Blob(
        [result.data.data],
        { type: result.data.content_type || 'image/jpeg' },
      ))
    }
    if (xDriveFileKind(item.name, item.kind) !== 'video') {
      try {
        return await loadCached(nodeID, signal)
      } catch {
        return null
      }
    }
    return xDriveResolveMediaVideoPoster({
      nodeID,
      revision: Number(item.revision),
      signal,
      loadCached,
      capture: async (requestSignal) => {
        requestSignal?.throwIfAborted()
        const result = await agent.cloudFilePreviewURL(nodeID)
        if (!result.ok || requestSignal?.aborted) return null
        return xDriveCaptureVideoPosterBlob(result.data, 0, 0, 0, 512, requestSignal)
      },
      save: async (id, revision, poster, requestSignal) => {
        requestSignal?.throwIfAborted()
        const bytes = await poster.arrayBuffer()
        requestSignal?.throwIfAborted()
        const result = await agent.putMediaVideoPoster(id, revision, bytes)
        if (!result.ok) throw new Error('video poster backfill failed')
      },
    })
  }

export const desktopOverviewPort: XDriveOverviewPort = {
  async cloudFileRecent(limit) {
    const result = await window.xdriveDesktop.agent.cloudFileRecent(limit)
    if (!result.ok) throw new Error('最近使用读取失败')
    return result.data
  },
  async cloudFileFavorites() {
    const result = await window.xdriveDesktop.agent.cloudFileFavorites()
    if (!result.ok) throw new Error('收藏读取失败')
    return result.data
  },
  async getFileAvailabilityBatch(paths) {
    const result = await window.xdriveDesktop.agent.getFileAvailabilityBatch(paths)
    if (!result.ok) throw new Error('文件可用性读取失败')
    return result.data.items
  },
  async getLocalDiskSpace() {
    const result = await window.xdriveDesktop.agent.getLocalDiskSpace()
    if (!result.ok) throw new Error('本机磁盘状态读取失败')
    return result.data
  },
  async openPath(relativePath) {
    const result = await window.xdriveDesktop.agent.openPath(relativePath)
    if (!result.ok) throw new Error(result.error.message)
  },
  loadThumbnail,
}
