import type { MediaBaiduNativeViewportBounds } from './models'

/** Account-local, bounded and ephemeral Viewer return intent. It is not an
 * authorization: current Owner/session/consent must be rechecked by Server. */
export interface XDriveBaiduViewportReturn {
  bounds: MediaBaiduNativeViewportBounds
  sort: { by: 'captured' | 'added'; dir: 'asc' | 'desc' }
  anchorNodeID?: number
  anchorIndex?: number
}
export const XDRIVE_BAIDU_VIEWPORT_RETURN_TTL_MS = 10 * 60 * 1000
type Entry = { value: XDriveBaiduViewportReturn; seen: number; viewerAt?: number }
const sessions = new Map<string, Entry>()
const validScope = (s:string) => typeof s === 'string' && s.length > 0 && s.length <= 1024
const validID = (v:unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const validIndex = (v:unknown) => v === undefined ||
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000)
function valid(v:XDriveBaiduViewportReturn):boolean {
  const b = v?.bounds
  return Boolean(b && b.coordinate_space === 'bd09ll' &&
    [b.west,b.south,b.east,b.north].every(Number.isFinite) &&
    b.west >= -180 && b.west <= 180 && b.east >= -180 && b.east <= 180 &&
    b.south >= -90 && b.north <= 90 && b.south < b.north && b.west !== b.east &&
    !(b.west === 180 && b.east === -180) &&
    (v.sort?.by === 'captured' || v.sort?.by === 'added') &&
    (v.sort?.dir === 'asc' || v.sort?.dir === 'desc') &&
    (v.anchorNodeID === undefined || validID(v.anchorNodeID)) && validIndex(v.anchorIndex))
}
function clone(v:XDriveBaiduViewportReturn):XDriveBaiduViewportReturn {
  return { bounds: {...v.bounds}, sort: {...v.sort},
    ...(v.anchorNodeID ? { anchorNodeID: v.anchorNodeID } : {}),
    ...(v.anchorIndex !== undefined ? { anchorIndex: v.anchorIndex } : {}) }
}
function sweep(now:number) {
  for (const [key,e] of sessions) {
    if (e.seen > now || now - e.seen >= XDRIVE_BAIDU_VIEWPORT_RETURN_TTL_MS)
      sessions.delete(key)
    else if (e.viewerAt !== undefined &&
      (e.viewerAt > now || now - e.viewerAt >= XDRIVE_BAIDU_VIEWPORT_RETURN_TTL_MS))
      e.viewerAt = undefined
  }
}
export function xDriveRememberBaiduViewportReturn(scope:string,v:XDriveBaiduViewportReturn,now=Date.now()) {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0 || !valid(v)) return false
  sweep(now)
  sessions.delete(scope)
  sessions.set(scope,{value:clone(v),seen:now})
  while (sessions.size > 8) {
    const first = sessions.keys().next().value
    if (first === undefined) break
    sessions.delete(first)
  }
  return true
}
export function xDriveRememberBaiduViewportAnchor(scope:string,nodeID:number,index?:number,now=Date.now()) {
  if (!validScope(scope) || !validID(nodeID) || !validIndex(index) ||
      !Number.isFinite(now) || now < 0) return false
  sweep(now)
  const e = sessions.get(scope)
  if (!e || !valid(e.value)) return false
  e.value.anchorNodeID = nodeID
  if (index !== undefined) e.value.anchorIndex = index
  e.seen = now
  return true
}
export function xDriveMarkBaiduViewportViewerReturn(scope:string,nodeID:number,index:number,now=Date.now()) {
  if (!xDriveRememberBaiduViewportAnchor(scope,nodeID,index,now)) return false
  const e = sessions.get(scope)
  if (!e) return false
  e.viewerAt = now
  return true
}
export function xDriveTakeBaiduViewportViewerReturn(scope:string,now=Date.now()): XDriveBaiduViewportReturn | undefined {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0) return undefined
  sweep(now)
  const e = sessions.get(scope)
  if (!e || e.viewerAt === undefined || !valid(e.value)) return undefined
  if (e.viewerAt > now || now - e.viewerAt >= XDRIVE_BAIDU_VIEWPORT_RETURN_TTL_MS) {
    e.viewerAt = undefined
    return undefined
  }
  e.viewerAt = undefined
  return clone(e.value)
}
export function xDriveClearBaiduViewportViewerReturn(scope:string) {
  if (validScope(scope)) { const e = sessions.get(scope); if(e)e.viewerAt=undefined }
}
export function xDriveClearBaiduViewportReturn(scope:string) {
  if (validScope(scope)) sessions.delete(scope)
}
