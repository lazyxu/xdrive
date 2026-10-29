import type {
  XDriveIOSPhotoBackupHost,
  XDriveIOSPhotoBackupProgress,
  XDriveIOSPhotoBackupSession,
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
type NativeProgress = { id?: string; data?: XDriveIOSPhotoBackupProgress }

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

  constructor(handler: NativeMessageHandler) {
    this.handler = handler
  }

  private request<T>(
    method: string,
    params: Record<string, unknown> = {},
    onProgress?: (progress: XDriveIOSPhotoBackupProgress) => void,
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
        const detail = (event as CustomEvent<NativeProgress>).detail
        if (detail?.id === id && detail.data) onProgress?.(detail.data)
      }
      window.addEventListener('xdrive-ios-host-response', response)
      window.addEventListener('xdrive-ios-host-progress', progress)
      // An actual foreground backup has no synthetic success deadline:
      // user cancel, backgrounding or Server reconciliation owns its end.
      if (method !== 'photos.backup.start') {
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
      protocolVersion: number; platform: string; photoKit: boolean; foregroundStillBackup: boolean
    }>('capabilities')
    return value?.protocolVersion === 1 &&
      value.platform === 'ios' && value.photoKit === true &&
      value.foregroundStillBackup === true
  }

  status(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus> {
    return this.request<XDriveIOSPhotoStatus>('photos.status', session)
  }

  requestAccess(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus> {
    return this.request<XDriveIOSPhotoStatus>('photos.requestAccess', session)
  }

  start(
    session: XDriveIOSPhotoBackupSession,
    allowICloudOriginals: boolean,
    onProgress: (progress: XDriveIOSPhotoBackupProgress) => void,
  ): Promise<XDriveIOSPhotoBackupProgress> {
    return this.request<XDriveIOSPhotoBackupProgress>(
      'photos.backup.start',
      { ...session, allowICloudOriginals },
      onProgress,
    )
  }

  async cancel(): Promise<void> {
    await this.request<{ cancelRequested: boolean }>('photos.backup.cancel')
  }
}

// These types are a public/shared Host contract. No iOS-native code is
// embedded into the PWA page component and no native Keychain token is read.
export type { XDriveIOSPhotoPermission }
