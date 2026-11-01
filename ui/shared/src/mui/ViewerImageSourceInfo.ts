/** Transient metadata for Viewer ObjectURLs; never store photo bytes. */
export type XDriveViewerImageSourceInfo = {
  format: 'WebP' | 'JPEG'
  quality: number
  byteSize: number
}
const sources = new Map<string, XDriveViewerImageSourceInfo>()
export function xDriveRegisterViewerImageSource(url: string, info: XDriveViewerImageSourceInfo) {
  if (!url.startsWith('blob:')) return
  sources.set(url, info)
  while (sources.size > 128) {
    const first = sources.keys().next().value
    if (!first) break
    sources.delete(first)
  }
}
export function xDriveViewerImageSource(url: string) {
  return sources.get(url) ?? null
}
export function xDriveForgetViewerImageSource(url: string) {
  sources.delete(url)
}
