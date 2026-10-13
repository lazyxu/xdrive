/**
 * Conservative, current-window-only PWA update diagnostics. This is not a
 * cross-window lease or permission to activate a waiting Service Worker.
 * No account identifiers, file paths, tokens or task payloads are recorded.
 */
export type XDrivePwaWindowActivity = Readonly<{
  observed: boolean
  browserUpload: boolean
  browserDownload: boolean
  viewerOpen: boolean
  unsavedSystemDependencies: boolean
}>

type ObservedActivity = Omit<XDrivePwaWindowActivity, 'observed'>
const unobserved: XDrivePwaWindowActivity = Object.freeze({
  observed: false,
  browserUpload: false,
  browserDownload: false,
  viewerOpen: false,
  unsavedSystemDependencies: false,
})
let current: XDrivePwaWindowActivity = unobserved
let currentOwner: object | null = null
const listeners = new Set<() => void>()

export function xDrivePwaWindowActivitySnapshot(): XDrivePwaWindowActivity {
  return current
}
export function subscribeXDrivePwaWindowActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function xDriveReportPwaWindowActivity(owner: object, activity: ObservedActivity): void {
  const next: XDrivePwaWindowActivity = { observed: true, ...activity }
  // Ownership still transfers when a subsequent Web FileManager has identical
  // booleans. Otherwise the previous instance could clear its successor.
  currentOwner = owner
  if (Object.keys(next).every(key =>
    current[key as keyof XDrivePwaWindowActivity] === next[key as keyof XDrivePwaWindowActivity])) return
  current = Object.freeze(next)
  for (const listener of listeners) listener()
}
export function xDriveClearPwaWindowActivity(owner: object): void {
  if (currentOwner !== owner) return
  currentOwner = null
  if (current === unobserved) return
  current = unobserved
  for (const listener of listeners) listener()
}
/** Known reasons to defer window closure; empty is NEVER proof of safe activation. */
export function xDrivePwaKnownWindowBlockers(activity: XDrivePwaWindowActivity): string[] {
  if (!activity.observed) return ['当前窗口活动尚不可确认']
  const reasons: string[] = []
  if (activity.browserUpload) reasons.push('浏览器前台上传')
  if (activity.browserDownload) reasons.push('浏览器前台下载')
  if (activity.viewerOpen) reasons.push('正在打开的 Viewer')
  if (activity.unsavedSystemDependencies) reasons.push('未保存的系统依赖配置')
  return reasons
}
