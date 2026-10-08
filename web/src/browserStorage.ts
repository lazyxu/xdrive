import type {
  XDriveBrowserStorageClearResult,
  XDriveBrowserStorageStats,
} from '@xdrive/ui/mui'

type DetailedStorageEstimate = StorageEstimate & {
  usageDetails?: {
    caches?: number
  }
}

function browserCacheStorage(): CacheStorage | null {
  if (typeof window === 'undefined' || !('caches' in window)) return null
  return window.caches
}

async function browserStorageEstimate(): Promise<DetailedStorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  return navigator.storage.estimate() as Promise<DetailedStorageEstimate>
}

export async function createWebBrowserStorageSnapshot(): Promise<XDriveBrowserStorageStats> {
  const cacheStorage = browserCacheStorage()
  const [estimate, cacheNames] = await Promise.all([
    browserStorageEstimate(),
    cacheStorage ? cacheStorage.keys() : Promise.resolve(undefined),
  ])

  return {
    supported: Boolean(estimate || cacheStorage),
    reason: estimate || cacheStorage ? undefined : '当前浏览器不提供站点存储统计或 Cache Storage 管理能力。',
    total_used_bytes: estimate?.usage,
    quota_bytes: estimate?.quota,
    cache_bytes: estimate?.usageDetails?.caches,
    cache_entries: cacheNames?.length,
    clear_supported: Boolean(cacheStorage),
    scope_label: '当前 xDrive 站点',
    detail: cacheStorage
      ? 'Web 只清理当前 xDrive 站点的 Cache Storage；浏览器 HTTP 缓存由浏览器自身管理。不会清除 Cookie、登录令牌、主题、布局或其他应用偏好。'
      : '当前浏览器不允许页面主动清理 Cache Storage；Cookie、登录令牌和本地偏好不会被修改。',
  }
}

export async function clearWebBrowserCache(): Promise<XDriveBrowserStorageClearResult> {
  const cacheStorage = browserCacheStorage()
  if (!cacheStorage) return { released_bytes: 0, cleared_entries: 0 }

  const before = await browserStorageEstimate()
  const names = await cacheStorage.keys()
  let clearedEntries = 0
  for (const name of names) {
    if (await cacheStorage.delete(name)) clearedEntries += 1
  }
  const after = await browserStorageEstimate()
  const releasedBytes = before?.usage !== undefined && after?.usage !== undefined
    ? Math.max(0, before.usage - after.usage)
    : undefined

  return {
    released_bytes: releasedBytes,
    cleared_entries: clearedEntries,
  }
}
