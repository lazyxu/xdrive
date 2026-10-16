import { xDriveBindBaiduJSAPI4NativeMap } from './media-gallery-baidu-jsapi4-native'
import { XDriveBaiduJSAPI4OwnerViewportBridge } from './media-gallery-baidu-jsapi4-viewport'
import type {
  XDriveBaiduJSAPI4OwnerListViewport,
  XDriveBaiduJSAPI4TrustedWGS84Bounds,
  XDriveBaiduJSAPI4ViewportCallbacks,
} from './media-gallery-baidu-jsapi4-viewport'

/**
 * A3b3a3d1c — inert composition of the official-shaped JSAPI4 constructors
 * and the ONE existing authenticated Owner viewport/ClusterLayer controller.
 *
 * This is NOT an authorization or SDK loader. An untrusted Browser-provided
 * "BMap" object cannot prove licence, Server release, session validity,
 * upstream allowlist, or a WGS84 viewport. There is NO production caller.
 */
export interface XDriveBaiduJSAPI4FutureOwnerMapInputs {
  /** Supplied by a FUTURE independently licensed and isolated JSAPI runtime. */
  map: unknown
  namespace: unknown
  /** Existing shared authenticated Gallery DataSource, not a direct fetch. */
  listOwnerViewport: XDriveBaiduJSAPI4OwnerListViewport
  /** Separately reviewed real WGS84 adapter, NEVER raw BMap.getBounds/BD09. */
  trustedWGS84Bounds: XDriveBaiduJSAPI4TrustedWGS84Bounds
  /** Original Gallery onOpenPlace -> Range/VirtualCollection/Viewer callback. */
  callbacks: XDriveBaiduJSAPI4ViewportCallbacks
}

const unavailable = 'baidu_jsapi4_composition_unavailable'

/** Pure construction only: does not load, enable, authorize or fetch a map. */
export function xDriveComposeBaiduJSAPI4OwnerViewport(
  inputs: XDriveBaiduJSAPI4FutureOwnerMapInputs,
): XDriveBaiduJSAPI4OwnerViewportBridge {
  try {
    if (!inputs || typeof inputs !== 'object' ||
        typeof inputs.listOwnerViewport !== 'function' ||
        typeof inputs.trustedWGS84Bounds !== 'function' ||
        !inputs.callbacks || typeof inputs.callbacks.onOpenPlace !== 'function') {
      throw new Error(unavailable)
    }
    const runtime = xDriveBindBaiduJSAPI4NativeMap(inputs.map, inputs.namespace)
    // Existing bridge owns transient AbortControllers, real Owner range
    // generation, native layer lifecycle, and Gallery selection identity.
    return new XDriveBaiduJSAPI4OwnerViewportBridge(
      runtime, inputs.listOwnerViewport, inputs.trustedWGS84Bounds, inputs.callbacks,
    )
  } catch {
    // No raw third-party errors, upstream URLs, user GPS or tokens in output.
    throw new Error(unavailable)
  }
}
