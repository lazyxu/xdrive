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
  getQuota: (signal?: AbortSignal) => Promise<XDriveTransportResult<QuotaUsage>>
  getStats?: (signal?: AbortSignal) => Promise<XDriveTransportResult<StorageStats | null>>
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
    load: async (signal?: AbortSignal): Promise<XDriveCloudStorageSnapshot> => {
      // Only disposable quota/statistics GETs use this page-owned signal.
      // An aborted old Owner must never update the app-wide quota either.
      signal?.throwIfAborted()
      const statsPromise = port.getStats
        ? tolerateStatsError
          ? port.getStats(signal).catch(() => {
            signal?.throwIfAborted()
            return null
          })
          : port.getStats(signal)
        : Promise.resolve(null)

      const [quotaResult, statsResult] = await Promise.all([
        port.getQuota(signal),
        statsPromise,
      ])
      signal?.throwIfAborted()
      const quota = await resolveXDriveTransport(Promise.resolve(quotaResult))
      signal?.throwIfAborted()

      let stats: StorageStats | null = null
      if (statsResult !== null) {
        try {
          stats = await resolveXDriveTransport(Promise.resolve(statsResult))
        } catch (error) {
          signal?.throwIfAborted()
          if (!tolerateStatsError) throw error
        }
      }
      signal?.throwIfAborted()
      onQuota?.(quota)
      return {
        quota,
        stats,
        statsUnavailableMessage: stats ? undefined : statsUnavailableMessage,
      }
    },
  }
}
