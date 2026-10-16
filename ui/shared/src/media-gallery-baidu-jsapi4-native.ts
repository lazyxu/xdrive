import type {
  XDriveBaiduJSAPI4AuthorizedRuntimePort,
  XDriveBaiduJSAPI4ClusterLayerPort,
  XDriveBaiduJSAPI4ClusterOptions,
  XDriveBaiduJSAPI4MapPort,
} from './media-gallery-baidu-jsapi4-layer'
import type {
  XDriveBaiduOfficialConvertor,
  XDriveBaiduOfficialPoint,
} from './media-gallery-baidu-jsapi4-markers'

/**
 * A3: inert binding for the documented, official Baidu JSAPI4 constructors.
 * A future separately approved loader supplies the namespace and map. Neither
 * a BMap-looking object nor a successful constructor call proves Server
 * authorization, licensed usage, signed release, or safe upstream resources.
 *
 * NO production caller: no global BMap access, Browser AK, script insertion,
 * map Cookie, cross-platform API fork, new basemap, or network request.
 */
export interface XDriveBaiduJSAPI4NativeNamespace {
  ClusterLayer: new (options: XDriveBaiduJSAPI4ClusterOptions) => XDriveBaiduJSAPI4ClusterLayerPort
  Convertor: new () => XDriveBaiduOfficialConvertor
  Point: new (lng: number, lat: number) => XDriveBaiduOfficialPoint
}

const unavailable = 'baidu_jsapi4_native_unavailable'

function hasMethods(value: unknown, names: readonly string[]): boolean {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    const candidate = value as Record<string, unknown>
    return names.every(name => typeof candidate[name] === 'function')
  } catch {
    return false
  }
}

function validClusterOptions(value: unknown): value is XDriveBaiduJSAPI4ClusterOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  const keys = Object.keys(v)
  return keys.length === 5 && keys.every(key => [
    'clusterRadius', 'enablePicked', 'fitViewOnClick', 'updateRealTime', 'idKey',
  ].includes(key)) &&
    v.clusterRadius === 60 && v.enablePicked === true &&
    v.fitViewOnClick === true && v.updateRealTime === false && v.idKey === 'id'
}

/**
 * Binds the official shape only, without invoking or authorizing JSAPI load.
 * The caller must independently supply a trusted, already licensed/sandboxed
 * native map; this function must never be used as an entitlement oracle.
 */
export function xDriveBindBaiduJSAPI4NativeMap(
  map: unknown, namespace: unknown,
): XDriveBaiduJSAPI4AuthorizedRuntimePort {
  if (!hasMethods(map, ['addLayer', 'removeLayer', 'addEventListener', 'removeEventListener']) ||
      !namespace || typeof namespace !== 'object') throw new Error(unavailable)
  const api = namespace as Partial<XDriveBaiduJSAPI4NativeNamespace>
  if (typeof api.ClusterLayer !== 'function' || typeof api.Convertor !== 'function' ||
      typeof api.Point !== 'function') throw new Error(unavailable)
  let convertor: XDriveBaiduOfficialConvertor
  try {
    convertor = new api.Convertor()
  } catch {
    throw new Error(unavailable)
  }
  if (!hasMethods(convertor, ['translate'])) throw new Error(unavailable)
  return {
    map: map as XDriveBaiduJSAPI4MapPort,
    convertor,
    createClusterLayer(options: XDriveBaiduJSAPI4ClusterOptions) {
      if (!validClusterOptions(options)) throw new Error(unavailable)
      try {
        const layer = new api.ClusterLayer!(options)
        if (!hasMethods(layer, ['setData', 'clearData', 'addEventListener', 'removeEventListener'])) {
          throw new Error(unavailable)
        }
        return layer
      } catch {
        throw new Error(unavailable)
      }
    },
    createPoint(lng: number, lat: number) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) ||
          Math.abs(lng) > 180 || Math.abs(lat) > 85) throw new Error(unavailable)
      try {
        const point = new api.Point!(lng, lat)
        if (!point || point.lng !== lng || point.lat !== lat) throw new Error(unavailable)
        return point
      } catch {
        throw new Error(unavailable)
      }
    },
  }
}
