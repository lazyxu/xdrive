import type { XDriveLocalStorageDataSource, XDriveLocalStorageSnapshot } from './mui/LocalStoragePage'

const scope = 'DSM 同源浏览器站点（不代表 NAS 硬盘）'
const detail = '这里仅统计浏览器对当前 HTTPS Origin 的站点存储估算；同源的其他 DSM 网页也可能计入。' +
  '不包含 NAS 磁盘、xdrive-agent/CAS 缓存或 xDrive Server 的账号配额。' +
  '此页面不清理 Cache Storage、登录 Cookie、令牌或任何 NAS 文件。'
const bytes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value) : undefined

/**
 * Native browser capability only. No DSM CGI or xDrive Server credential
 * is read, persisted, inferred or sent. Never represent site quota as NAS disk.
 */
export function createXDriveSynologyBrowserStorageSource(): XDriveLocalStorageDataSource {
  return {
    async load(): Promise<XDriveLocalStorageSnapshot> {
      if (typeof navigator === 'undefined' || !globalThis.isSecureContext ||
        !navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return { browserStorage: {
          supported: false, clear_supported: false, scope_label: scope,
          reason: '当前浏览器未提供安全上下文中的 StorageManager.estimate；NAS 磁盘未检测。',
        } }
      }

      let estimate: StorageEstimate
      try {
        estimate = await navigator.storage.estimate()
      } catch {
        return { browserStorage: {
          supported: false, clear_supported: false, scope_label: scope,
          reason: '浏览器拒绝站点存储估算；没有访问或修改 NAS 文件。',
        } }
      }
      // Cache names themselves are not exposed; this optional count never
      // becomes evidence of bytes that can safely be reclaimed.
      let cacheCount: number | undefined
      if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
        try {
          const names = await caches.keys()
          cacheCount = Number.isSafeInteger(names.length) ? names.length : undefined
        } catch {
          cacheCount = undefined
        }
      }
      return { browserStorage: {
        supported: true,
        clear_supported: false,
        scope_label: scope,
        usage_scope_label: 'DSM 同源浏览器站点',
        total_used_bytes: bytes(estimate.usage),
        quota_bytes: bytes(estimate.quota),
        cache_entries: cacheCount,
        detail,
      } }
    },
  }
}
