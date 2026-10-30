import type {
  XDriveIOSPhotoBackupHost,
  XDriveIOSPhotoBackupProgress,
  XDriveIOSPhotoBackupSession,
  XDriveIOSPhotoBackgroundGrantStatus,
  XDriveIOSReceiptReviewProgress,
  XDriveIOSReceiptReviewStatus,
  XDriveIOSPhotoAutoStatus,
  XDriveIOSPhotoAutoTickResult,
  XDriveIOSPhotoPermission,
  XDriveIOSPhotoStatus,
} from '../../ui/shared/src/mui/IOSPhotoBackupSettings'

type NativeMessageHandler = { postMessage: (message: unknown) => void }
type IOSHostWindow = Window & {
  webkit?: { messageHandlers?: { xdriveIOSHost?: NativeMessageHandler } }
}
type NativeResponse = {
  id?: string
  ok?: boolean
  data?: unknown
  error?: string
}
type NativeProgress<P> = { id?: string; data?: P }

/** Only iOS WKWebView installs the named native message handler.
 * Normal Web/PWA/DSM/Desktop have no adapter and no Photos controls. */
export function xDriveCreateIOSPhotoBackupHost(): XDriveIOSPhotoBackupHost | null {
  if (window.location.protocol !== 'https:') return null
  const handler = (window as IOSHostWindow).webkit?.messageHandlers?.xdriveIOSHost
  if (!handler || typeof handler.postMessage !== 'function') return null
  return new IOSPhotoBackupHost(handler)
}

class IOSPhotoBackupHost implements XDriveIOSPhotoBackupHost {
  private readonly handler: NativeMessageHandler
  scanWindowsSupported = false
  receiptReviewSupported = false
  foregroundAutoSupported = false
  originalVideoSupported = false
  liveOriginalBundleSupported = false
  nativeBackgroundGrantSupported = false

  constructor(handler: NativeMessageHandler) {
    this.handler = handler
  }

  private request<T, P = XDriveIOSPhotoBackupProgress>(
    method: string,
    params: Record<string, unknown> = {},
    onProgress?: (progress: P) => void,
  ): Promise<T> {
    if (!window.crypto?.randomUUID) {
      return Promise.reject(new Error('当前安全环境无法建立原生操作请求。'))
    }
    const id = window.crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      let timer: number | null = null
      const cleanup = () => {
        window.removeEventListener('xdrive-ios-host-response', response)
        window.removeEventListener('xdrive-ios-host-progress', progress)
        if (timer !== null) window.clearTimeout(timer)
      }
      const response = (event: Event) => {
        const detail = (event as CustomEvent<NativeResponse>).detail
        if (!detail || detail.id !== id || typeof detail.ok !== 'boolean') return
        cleanup()
        if (detail.ok) resolve(detail.data as T)
        else reject(new Error(typeof detail.error === 'string' ? detail.error : '原生操作未完成。'))
      }
      const progress = (event: Event) => {
        const detail = (event as CustomEvent<NativeProgress<P>>).detail
        if (detail?.id === id && detail.data) onProgress?.(detail.data)
      }
      window.addEventListener('xdrive-ios-host-response', response)
      window.addEventListener('xdrive-ios-host-progress', progress)
      // An actual foreground backup has no synthetic success deadline:
      // user cancel, backgrounding or Server reconciliation owns its end.
      if (method !== 'photos.backup.start' &&
          method !== 'photos.reconcile.start' &&
          method !== 'photos.auto.tick') {
        timer = window.setTimeout(() => {
          cleanup()
          reject(new Error('原生操作未在规定时间内响应。'))
        }, method === 'photos.requestAccess' ? 120_000 : 30_000)
      }
      try {
        this.handler.postMessage({ version: 1, id, method, params })
      } catch {
        cleanup()
        reject(new Error('无法调用 iOS Host Adapter。'))
      }
    })
  }

  async capabilities(): Promise<boolean> {
    const value = await this.request<{
      protocolVersion: number; platform: string; photoKit: boolean
      foregroundStillBackup: boolean; scanWindows?: boolean
      receiptReview?: boolean; foregroundAutoSchedule?: boolean
      originalVideo?: boolean; liveOriginalBundle?: boolean
      nativeBackgroundGrant?: boolean
    }>('capabilities')
    const supported = value?.protocolVersion === 1 &&
      value.platform === 'ios' && value.photoKit === true &&
      value.foregroundStillBackup === true
    this.scanWindowsSupported = supported && value.scanWindows === true
    this.receiptReviewSupported = supported && value.receiptReview === true
    this.foregroundAutoSupported = supported && value.foregroundAutoSchedule === true
    this.originalVideoSupported = supported && value.originalVideo === true
    this.liveOriginalBundleSupported = supported && value.liveOriginalBundle === true
    this.nativeBackgroundGrantSupported = supported && value.nativeBackgroundGrant === true
    return supported
  }

  status(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus> {
    return this.request<XDriveIOSPhotoStatus>('photos.status', { ...session })
  }

  requestAccess(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus> {
    return this.request<XDriveIOSPhotoStatus>('photos.requestAccess', { ...session })
  }

  start(
    session: XDriveIOSPhotoBackupSession,
    allowICloudOriginals: boolean,
    onProgress: (progress: XDriveIOSPhotoBackupProgress) => void,
    windowIndex = 0,
  ): Promise<XDriveIOSPhotoBackupProgress> {
    if (!Number.isSafeInteger(windowIndex) || windowIndex < 0) {
      return Promise.reject(new Error('相册分段编号无效。'))
    }
    if (!this.scanWindowsSupported && windowIndex !== 0) {
      return Promise.reject(new Error('当前安装的 iOS App 暂不支持分段备份，请更新 IPA。'))
    }
    return this.request<XDriveIOSPhotoBackupProgress>(
      'photos.backup.start',
      { ...session, allowICloudOriginals,
        ...(this.scanWindowsSupported ? { windowIndex } : {}) },
      onProgress,
    )
  }

  reviewStatus(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSReceiptReviewStatus> {
    if (!this.receiptReviewSupported) {
      return Promise.reject(new Error('当前安装的 iOS IPA 不支持本地收据核对。'))
    }
    return this.request<XDriveIOSReceiptReviewStatus>(
      'photos.reconcile.status', { ...session },
    )
  }

  reviewPending(
    session: XDriveIOSPhotoBackupSession,
    onProgress: (progress: XDriveIOSReceiptReviewProgress) => void,
  ): Promise<XDriveIOSReceiptReviewProgress> {
    if (!this.receiptReviewSupported) {
      return Promise.reject(new Error('当前安装的 iOS IPA 不支持本地收据核对。'))
    }
    return this.request<XDriveIOSReceiptReviewProgress, XDriveIOSReceiptReviewProgress>(
      'photos.reconcile.start', { ...session }, onProgress,
    )
  }

  autoStatus(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoAutoStatus> {
    if (!this.foregroundAutoSupported)
      return Promise.reject(new Error('当前 IPA 不支持前台自动增量备份。'))
    return this.request<XDriveIOSPhotoAutoStatus>('photos.auto.status', { ...session })
  }

  async configureAuto(
    session: XDriveIOSPhotoBackupSession,
    enabled: boolean, intervalMinutes: number, allowICloudOriginals: boolean,
  ): Promise<XDriveIOSPhotoAutoStatus> {
    if (!this.foregroundAutoSupported)
      throw new Error('当前 IPA 不支持前台自动增量备份。')
    const status = await this.request<XDriveIOSPhotoAutoStatus>(
      'photos.auto.configure',
      { ...session, enabled, intervalMinutes, allowICloudOriginals }
    )
    // The native host has explicitly confirmed and stored the same Owner's
    // preference. Wake only the foreground scheduler, not a background task.
    window.dispatchEvent(new Event('xdrive-ios-auto-config-changed'))
    return status
  }

  autoTick(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoAutoTickResult> {
    if (!this.foregroundAutoSupported)
      return Promise.resolve({ ran: false, reason: 'unsupported' })
    return this.request<XDriveIOSPhotoAutoTickResult>(
      'photos.auto.tick', { ...session }
    )
  }

  backgroundGrantStatus(
    session: XDriveIOSPhotoBackupSession,
  ): Promise<XDriveIOSPhotoBackgroundGrantStatus> {
    if (!this.nativeBackgroundGrantSupported) {
      return Promise.reject(new Error('当前 iOS IPA 尚未提供原生后台授权管理。'))
    }
    return this.request<XDriveIOSPhotoBackgroundGrantStatus>(
      'photos.background.grant.status', { ...session },
    )
  }

  configureBackgroundGrant(
    session: XDriveIOSPhotoBackupSession,
    enabled: boolean,
  ): Promise<XDriveIOSPhotoBackgroundGrantStatus> {
    if (!this.nativeBackgroundGrantSupported) {
      return Promise.reject(new Error('当前 iOS IPA 尚未提供原生后台授权管理。'))
    }
    // The actual consent dialog, device registration, Keychain and server
    // proof all run natively. JS only receives redacted status.
    return this.request<XDriveIOSPhotoBackgroundGrantStatus>(
      'photos.background.grant.configure',
      { ...session, enabled },
    )
  }

  emergencyStopBackground(): Promise<{
    localStopped: boolean; remoteRevokePending: boolean
    foregroundSchedulesStopped?: number
  }> {
    if (!this.nativeBackgroundGrantSupported)
      return Promise.reject(new Error('当前 IPA 尚未提供原生后台安全停止能力。'))
    // Stop-only: intentionally send NO login/Owner token or Keychain value.
    // The host is restricted to a trusted HTTPS main-frame origin.
    return this.request('photos.background.emergencyStop')
  }

  async cancel(): Promise<void> {
    await this.request<{ cancelRequested: boolean }>('photos.backup.cancel')
  }

  async switchServer(): Promise<void> {
    const reply = await this.request<{ confirmationRequested: boolean }>('host.server.change')
    if (!reply?.confirmationRequested) throw new Error('iOS 尚未确认服务器切换操作。')
  }
}

// These types are a public/shared Host contract. No iOS-native code is
// embedded into the PWA page component and no native Keychain token is read.
export type { XDriveIOSPhotoPermission }
