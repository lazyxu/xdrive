import type {
  QuotaUsage,
  StorageStats,
} from '../models'
import {
  resolveXDriveTransport,
  type XDriveTransportResult,
} from '../transport-result'
import type {
  XDriveCloudStorageDataSource,
  XDriveCloudStorageSnapshot,
} from './CloudStoragePage'

export interface XDriveCloudStoragePort {
  getQuota: () => Promise<XDriveTransportResult<QuotaUsage>>
  getStats?: () => Promise<XDriveTransportResult<StorageStats | null>>
}

export type XDriveCloudStorageDataSourceOptions = {
  onQuota?: (quota: QuotaUsage) => void
  tolerateStatsError?: boolean
  statsUnavailableMessage?: string
}

export function createXDriveCloudStorageDataSource(
  port: XDriveCloudStoragePort,
  {
    onQuota,
    tolerateStatsError = false,
    statsUnavailableMessage,
  }: XDriveCloudStorageDataSourceOptions = {},
): XDriveCloudStorageDataSource {
  return {
    load: async (): Promise<XDriveCloudStorageSnapshot> => {
      const statsPromise = port.getStats
        ? tolerateStatsError
          ? port.getStats().catch(() => null)
          : port.getStats()
        : Promise.resolve(null)

      const [quotaResult, statsResult] = await Promise.all([
        port.getQuota(),
        statsPromise,
      ])

      const quota = await resolveXDriveTransport(Promise.resolve(quotaResult))
      onQuota?.(quota)

      let stats: StorageStats | null = null
      if (statsResult !== null) {
        try {
          stats = await resolveXDriveTransport(Promise.resolve(statsResult))
        } catch (error) {
          if (!tolerateStatsError) throw error
        }
      }

      return {
        quota,
        stats,
        statsUnavailableMessage: stats ? undefined : statsUnavailableMessage,
      }
    },
  }
}
