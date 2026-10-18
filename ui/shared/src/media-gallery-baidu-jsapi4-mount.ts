import { xDriveComposeBaiduJSAPI4OwnerViewport } from './media-gallery-baidu-jsapi4-composition'
import type {
  XDriveBaiduJSAPI4OwnerListViewport,
  XDriveBaiduJSAPI4TrustedWGS84Bounds,
  XDriveBaiduJSAPI4ViewportCallbacks,
  XDriveBaiduJSAPI4ViewportResult,
  XDriveBaiduJSAPI4OwnerViewportBridge,
} from './media-gallery-baidu-jsapi4-viewport'

/**
 * Shared Web/Mobile Web/Desktop authorized runtime bridge. This is an SDK
 * lifecycle port, not a license oracle or script/AK loader. Only a future
 * independently signed, Server-authorized JSAPI4 same-origin transport may
 * supply acquire(). It must verify Owner/session/release/child policy and
 * issue a narrowly scoped map Cookie before any upstream request.
 * No production caller supplies this port while runtime_enabled=false.
 */
export interface XDriveBaiduJSAPI4MountedMap {
  map: unknown
  namespace: unknown
  /** Original photo WGS84, NEVER directly relabeled native BD-09 bounds. */
  trustedWGS84Bounds: XDriveBaiduJSAPI4TrustedWGS84Bounds
  dispose(): void
}

export type XDriveBaiduJSAPI4InitialPhotoCamera = {
  latitude: number
  longitude: number
  zoom: number
}

export interface XDriveBaiduJSAPI4AuthorizedMountPort {
  /** Use official WGS84→BD09 conversion for the initial original photo GPS. */
  acquire(container: HTMLElement, signal: AbortSignal,
    camera: XDriveBaiduJSAPI4InitialPhotoCamera): Promise<XDriveBaiduJSAPI4MountedMap>
}

const unavailable = { kind: 'query-unavailable' } as const
const cancelled = { kind: 'cancelled' } as const
const acquireTimeoutMs = 8000

/** Do not propagate raw third-party SDK or upstream errors into UI/logs. */
function safeDispose(mounted: XDriveBaiduJSAPI4MountedMap | null | undefined) {
  try { mounted?.dispose() } catch { /* fail-closed cleanup */ }
}

/** One native Map+ClusterLayer and ONE Owner DataSource across all clients. */
export class XDriveBaiduJSAPI4MountLifecycle {
  private generation = 0
  private abort: AbortController | null = null
  private activeMap: XDriveBaiduJSAPI4MountedMap | null = null
  private bridge: XDriveBaiduJSAPI4OwnerViewportBridge | null = null
  private destroyed = false

  close(): void {
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.bridge?.dispose()
    this.bridge = null
    safeDispose(this.activeMap)
    this.activeMap = null
  }

  async open(
    element: HTMLElement,
    authorizedMount: XDriveBaiduJSAPI4AuthorizedMountPort,
    listOwnerViewport: XDriveBaiduJSAPI4OwnerListViewport,
    callbacks: XDriveBaiduJSAPI4ViewportCallbacks,
    camera: XDriveBaiduJSAPI4InitialPhotoCamera,
  ): Promise<XDriveBaiduJSAPI4ViewportResult> {
    this.close()
    if (this.destroyed || !element || !authorizedMount ||
        typeof authorizedMount.acquire !== 'function' ||
        typeof listOwnerViewport !== 'function' ||
        !callbacks || typeof callbacks.onOpenPlace !== 'function' ||
        !camera || ![camera.latitude, camera.longitude, camera.zoom].every(Number.isFinite) ||
        Math.abs(camera.latitude) > 85 || Math.abs(camera.longitude) > 180 ||
        !Number.isInteger(camera.zoom) || camera.zoom < 3 || camera.zoom > 18) {
      return unavailable
    }

    const version = this.generation
    const controller = new AbortController()
    this.abort = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    let mounted: XDriveBaiduJSAPI4MountedMap | null = null
    try {
      // Provider ignoring AbortSignal must not block unmount. Dispose a late
      // native map without installing its layer or querying user photos.
      const acquirePromise = Promise.resolve().then(() =>
        authorizedMount.acquire(element, controller.signal, camera))
      const pending = new Promise<XDriveBaiduJSAPI4MountedMap>((resolve, reject) => {
        abortListener = () => reject(new Error('baidu_jsapi4_mount_cancelled'))
        controller.signal.addEventListener('abort', abortListener, { once: true })
        acquirePromise.then(candidate => {
          if (controller.signal.aborted || this.destroyed ||
              version !== this.generation) {
            safeDispose(candidate)
            abortListener?.()
            return
          }
          resolve(candidate)
        }, () => reject(new Error('baidu_jsapi4_mount_unavailable')))
      })
      timer = setTimeout(() => controller.abort(), acquireTimeoutMs)
      mounted = await pending
      if (controller.signal.aborted || this.destroyed || version !== this.generation ||
          !mounted || typeof mounted.dispose !== 'function' ||
          typeof mounted.trustedWGS84Bounds !== 'function') return unavailable

      const bridge = xDriveComposeBaiduJSAPI4OwnerViewport({
        map: mounted.map, namespace: mounted.namespace,
        listOwnerViewport, trustedWGS84Bounds: mounted.trustedWGS84Bounds,
        callbacks,
      })
      this.activeMap = mounted
      this.bridge = bridge
      mounted = null
      const result = await bridge.refresh()
      if (controller.signal.aborted || this.destroyed ||
          version !== this.generation) return cancelled
      if (result.kind !== 'rendered' && result.kind !== 'incomplete' &&
          result.kind !== 'cancelled') this.close()
      return result
    } catch {
      const wasCancelled = controller.signal.aborted || this.destroyed ||
        version !== this.generation
      if (!wasCancelled && this.abort === controller) this.close()
      return wasCancelled ? cancelled : unavailable
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
      safeDispose(mounted)
      if (this.abort === controller) this.abort = null
    }
  }

  dispose(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.close()
  }
}
