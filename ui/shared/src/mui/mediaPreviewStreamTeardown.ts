// Synchronously stop old signed preview HTTP Range work when React removes
// a Web/Mobile/Desktop Viewer or replaces its Node/Owner/revision. No cache.
export function xDriveAbortHTMLMediaElement(media: HTMLMediaElement | null): void {
  if (!media) return
  try { media.pause() } catch { /* Already detached. */ }
  media.removeAttribute('src')
  try { media.load() } catch { /* The old element is already disconnected. */ }
}
