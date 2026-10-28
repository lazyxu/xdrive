import { xDriveDesktopViewportRequest } from './abortableViewportRequest'
import type { XDriveCloudFilesPort } from '@xdrive/shared'
import type { XDriveFileExplorerSort } from '@xdrive/ui/mui'

/**
 * The single Desktop/Electron authenticated read adapter for shared Cloud
 * Files. Shared ui/mui owns directory lifecycle, virtualization and priority;
 * this module only forwards methods allowed by the Desktop preload contract.
 *
 * The provider is resolved per request so an Agent re-enrollment is never
 * silently pinned to an old preload object. No credentials, paths or private
 * file bytes enter the shared Files controller.
 */
export type DesktopCloudFilesReadAgent = Pick<
  Window['xdriveDesktop']['agent'],
  'cloudRoot' | 'cloudChildrenPage' | 'cloudChildrenRange' | 'cloudChanges' | 'cloudQuota'
>

export function createDesktopCloudFilesHostPort(
  agent: () => DesktopCloudFilesReadAgent,
  cloudChangeFeedSupported: boolean,
): XDriveCloudFilesPort<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort> {
  return {
    getRoot: async () => {
      const result = await agent().cloudRoot()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getPage: async (parentID, options) => {
      const result = await agent().cloudChildrenPage(parentID, options)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getRange: async (parentID, offset, limit, sort, includeCount, grouping, signal) => {
      const result = await xDriveDesktopViewportRequest(signal, requestID =>
        agent().cloudChildrenRange(
          parentID, offset, limit, sort.key, sort.direction,
          includeCount, grouping, requestID,
        ))
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    // Missing optional capability remains unavailable, not an empty feed.
    getChanges: cloudChangeFeedSupported
      ? async (after, limit) => {
          const result = await agent().cloudChanges(after, limit)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    getQuota: async () => {
      const result = await agent().cloudQuota()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }
}
