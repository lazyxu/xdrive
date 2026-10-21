import type {
  XDriveBaiduJSAPI4AuthorizedMountPort,
  XDriveBaiduJSAPI4InitialPhotoCamera,
  XDriveBaiduJSAPI4MountedMap,
} from './media-gallery-baidu-jsapi4-mount'
import type { XDriveBaiduJSAPI4TrustedWGS84Bounds } from './media-gallery-baidu-jsapi4-viewport'

/**
 * Real same-origin JSAPI 4.0 script acquisition for an independently APPROVED
 * Server session, shared by Web, Mobile Web/PWA and an HTTPS-isolated Desktop
 * map view. This file cannot grant permission: /_BMapService/* MUST reject
 * requests unless Server verifies the current signed release, Owner/session,
 * epoch, Browser AK revision, resource allowlist, quota and map-only Cookie.
 *
 * In particular, NEVER render the provider's public AK-bearing URL and NEVER treat
 * a local flag, existing window.BMap or a mocked session as production proof.
 * An Electron file: page cannot mint/use an HTTPS host-only map Cookie; it
 * must use an independently reviewed HTTPS-isolated map view.
 */
export type XDriveBaiduJSAPI4SessionGrant = {
  provider: 'baidu-jsapi-4.0'
  runtime_enabled: true
}

type NativePoint = { lng: number; lat: number }
type NativeMap = {
  centerAndZoom(point: NativePoint, zoom: number): void
  destroy?(): void
}
type NativeNamespace = {
  Map: new (element: HTMLElement) => NativeMap
  Point: new (longitude: number, latitude: number) => NativePoint
  Convertor: new () => {
    translate(points: NativePoint[], from: number, to: number,
      callback: (result: { status?: number; points?: NativePoint[] }) => void): void
  }
  ClusterLayer: new (options: unknown) => unknown
}
type MapWindow = Window & {
  BMap?: unknown
  _BMapSecurityConfig?: { serviceHost?: string }
}
export type XDriveBaiduJSAPI4SameOriginOptions = {
  /** Authenticated Server POST; must issue a real Secure/HttpOnly map Cookie. */
  mintMapOnlySession(signal: AbortSignal): Promise<XDriveBaiduJSAPI4SessionGrant>
  /** Independent PHOTO-WGS84 view, never BMap.getBounds() relabeled as GPS. */
  trustedWGS84Bounds: XDriveBaiduJSAPI4TrustedWGS84Bounds
}

const unavailable = 'baidu_jsapi4_not_authorized'
const trustedSDK = new WeakMap<Document, NativeNamespace>()
type PendingSDKLoad = {
  promise: Promise<NativeNamespace>
  consumers: number
  cancel(): void
}
const pendingSDK = new WeakMap<Document, PendingSDKLoad>()

function validNativeNamespace(candidate: unknown): candidate is NativeNamespace {
  if (!candidate || typeof candidate !== 'object') return false
  const v = candidate as Partial<NativeNamespace>
  return typeof v.Map === 'function' && typeof v.Point === 'function' &&
    typeof v.Convertor === 'function' && typeof v.ClusterLayer === 'function'
}

function secureDocument(): {
  document: Document
  browser: MapWindow
  serviceHost: string
} {
  if (typeof document === 'undefined' || !document.head || !document.defaultView) {
    throw new Error(unavailable)
  }
  const browser = document.defaultView as MapWindow
  const origin = browser.location.origin
  // No file:, http:, opaque, mixed-origin or client-provided base URL.
  if (browser.location.protocol !== 'https:' ||
      !/^https:\/\/[^/?#]+$/.test(origin) ||
      new URL(origin).origin !== origin) {
    throw new Error(unavailable)
  }
  return { document, browser, serviceHost: origin + '/_BMapService/' }
}

/** Abort this consumer immediately even if a third-party script ignores abort. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(unavailable))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error(unavailable)) }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => { cleanup(); resolve(value) },
      () => { cleanup(); reject(new Error(unavailable)) })
  })
}

function loadSDK(doc: Document, browser: MapWindow, serviceHost: string,
  signal: AbortSignal): Promise<NativeNamespace> {
  // An expired gallery generation must never start a script after its Owner
  // session has already been cancelled.
  if (signal.aborted) return Promise.reject(new Error(unavailable))
  const previous = browser._BMapSecurityConfig
  if (previous && previous.serviceHost !== serviceHost) {
    return Promise.reject(new Error(unavailable))
  }
  const already = trustedSDK.get(doc)
  if (already) {
    if (browser.BMap !== already) return Promise.reject(new Error(unavailable))
    return abortable(Promise.resolve(already), signal)
  }

  let pending = pendingSDK.get(doc)
  if (!pending) {
    browser._BMapSecurityConfig = { serviceHost }
    let cancelLoad: () => void = () => {}
    const promise = new Promise<NativeNamespace>((resolve, reject) => {
      const script = doc.createElement('script')
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null
      const finish = (sdk: NativeNamespace | null) => {
        if (settled) return
        settled = true
        if (timeout !== null) clearTimeout(timeout)
        script.onload = null
        script.onerror = null
        if (!sdk) {
          script.remove()
          reject(new Error(unavailable))
          return
        }
        trustedSDK.set(doc, sdk)
        resolve(sdk)
      }
      cancelLoad = () => finish(null)
      script.async = true
      script.type = 'text/javascript'
      // Fixed same-origin, exact JSAPI4 route, NO client AK or URL input.
      script.src = new URL('/_BMapService/api?v=4.0', serviceHost).href
      script.referrerPolicy = 'no-referrer'
      script.onload = () => {
        finish(validNativeNamespace(browser.BMap) ? browser.BMap : null)
      }
      script.onerror = () => finish(null)
      // A hung third-party script may never deliver onload OR onerror. A
      // bounded deadline must release its shared slot so a new signed Owner
      // session can retry without reusing a permanently pending Promise.
      timeout = setTimeout(() => finish(null), 8_000)
      try {
        doc.head.appendChild(script)
      } catch {
        finish(null)
      }
    })
    pending = { promise, consumers: 0, cancel: () => cancelLoad() }
    pendingSDK.set(doc, pending)
    const active = pending
    void promise.then(
      () => {
        if (pendingSDK.get(doc) === active) pendingSDK.delete(doc)
      },
      () => {
        if (pendingSDK.get(doc) === active) {
          pendingSDK.delete(doc)
          if (!trustedSDK.has(doc) &&
              browser._BMapSecurityConfig?.serviceHost === serviceHost) {
            if (previous) browser._BMapSecurityConfig = previous
            else delete browser._BMapSecurityConfig
          }
        }
      },
    )
  }

  const active = pending
  active.consumers++
  return abortable(active.promise, signal).finally(() => {
    active.consumers--
    // Each Web/Mobile/PWA/HTTPS Desktop viewer cancels independently. One
    // cancellation must not break another; when the LAST viewer navigates
    // away, remove the shared script immediately instead of continuing to
    // spend Baidu quota and load tiles for an obsolete Gallery viewport.
    if (active.consumers === 0 && pendingSDK.get(doc) === active) {
      active.cancel()
    }
  })
}

/** Official WGS84 (1) -> BD-09 (5), not a hand-rolled coordinate guess. */
function originalPhotoPoint(namespace: NativeNamespace,
  camera: XDriveBaiduJSAPI4InitialPhotoCamera,
  signal: AbortSignal): Promise<NativePoint> {
  return abortable(new Promise<NativePoint>((resolve, reject) => {
    try {
      const converter = new namespace.Convertor()
      const original = new namespace.Point(camera.longitude, camera.latitude)
      converter.translate([original], 1, 5, response => {
        const p = response?.points?.[0]
        if (response?.status !== 0 || response.points?.length !== 1 || !p ||
            !Number.isFinite(p.lng) || !Number.isFinite(p.lat) ||
            Math.abs(p.lng) > 180 || Math.abs(p.lat) > 85) {
          reject(new Error(unavailable))
        } else resolve(p)
      })
    } catch {
      reject(new Error(unavailable))
    }
  }), signal)
}

/**
 * One production-shaped browser SDK loader. The source of authorization is the
 * Server POST and subsequent per-resource Cookie checks, never this factory.
 * Unlike the existing synthetic mount tests, this loads the REAL /api script
 * when—and only when—the Server has issued a valid map session.
 */
export function xDriveCreateBaiduJSAPI4SameOriginMount(
  options: XDriveBaiduJSAPI4SameOriginOptions,
): XDriveBaiduJSAPI4AuthorizedMountPort {
  if (!options || typeof options.mintMapOnlySession !== 'function' ||
      typeof options.trustedWGS84Bounds !== 'function') {
    throw new Error(unavailable)
  }
  return {
    async acquire(container, signal, camera): Promise<XDriveBaiduJSAPI4MountedMap> {
      if (!container || signal.aborted || !camera ||
          ![camera.latitude, camera.longitude, camera.zoom].every(Number.isFinite) ||
          Math.abs(camera.latitude) > 85 || Math.abs(camera.longitude) > 180 ||
          !Number.isInteger(camera.zoom) || camera.zoom < 3 || camera.zoom > 18 ||
          (camera.coordinate_space !== undefined &&
            camera.coordinate_space !== 'wgs84' && camera.coordinate_space !== 'bd09ll')) {
        throw new Error(unavailable)
      }
      const { document: doc, browser, serviceHost } = secureDocument()
      if (container.ownerDocument !== doc) throw new Error(unavailable)
      // This must be an authenticated Owner API request. No bearer is passed
      // to the external script; the result contains no token/AK/GPS.
      let grant: XDriveBaiduJSAPI4SessionGrant
      try {
        grant = await abortable(options.mintMapOnlySession(signal), signal)
      } catch {
        throw new Error(unavailable)
      }
      if (signal.aborted || grant?.provider !== 'baidu-jsapi-4.0' ||
          grant.runtime_enabled !== true) throw new Error(unavailable)
      const namespace = await loadSDK(doc, browser, serviceHost, signal)
      if (signal.aborted) throw new Error(unavailable)
      let map: NativeMap | null = null
      try {
        // The API's public BMap namespace is accepted only after our
        // authenticated, same-origin loader actually completed.
        const point = camera.coordinate_space === 'bd09ll'
          ? new namespace.Point(camera.longitude, camera.latitude)
          : await originalPhotoPoint(namespace, camera, signal)
        if (signal.aborted || !point ||
            !Number.isFinite(point.lng) || !Number.isFinite(point.lat) ||
            Math.abs(point.lng) > 180 || Math.abs(point.lat) > 85) {
          throw new Error(unavailable)
        }
        // BD09LL is a separate, explicit native camera only. Unlabeled original
        // photo GPS always uses Baidu's official WGS84(1)->BD09(5) conversion.
        map = new namespace.Map(container)
        map.centerAndZoom(point, camera.zoom)
        const initialized = map
        return {
          map: initialized,
          namespace,
          trustedWGS84Bounds: options.trustedWGS84Bounds,
          dispose() {
            try { initialized.destroy?.() } catch { /* no raw SDK errors */ }
          },
        }
      } catch {
        try { map?.destroy?.() } catch { /* no raw SDK errors */ }
        throw new Error(unavailable)
      }
    },
  }
}


/** A3c16: use the already signed Owner Session + same-origin Loader for a
 * derived BD09 photo map. This bridge NEVER requests WGS84 bounds: the
 * dedicated native ClusterLayer reads tagged BD09 Server Owner points.
 * Old WGS84 bridge is deliberately unavailable (not forged).
 */
export function xDriveCreateBaiduJSAPI4IndexedBD09Mount(
  options: Pick<XDriveBaiduJSAPI4SameOriginOptions, 'mintMapOnlySession'>,
) {
  if (!options || typeof options.mintMapOnlySession !== 'function') {
    throw new Error(unavailable)
  }
  const existing = xDriveCreateBaiduJSAPI4SameOriginMount({
    mintMapOnlySession: options.mintMapOnlySession,
    trustedWGS84Bounds: async () => { throw new Error(unavailable) },
  })
  return {
    async acquire(container: HTMLElement, signal: AbortSignal,
      camera: XDriveBaiduJSAPI4InitialPhotoCamera):
      Promise<Pick<XDriveBaiduJSAPI4MountedMap, 'map' | 'namespace' | 'dispose'>> {
      const approved = await existing.acquire(container, signal, camera)
      return { map: approved.map, namespace: approved.namespace, dispose: approved.dispose }
    },
  }
}
