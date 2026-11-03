/** Owner-controlled notes are Markdown documents, never trusted HTML or URLs.
 * All clients must reject remote/absolute embedded image paths and traversal.
 * The Host may resolve a relative asset only with the current Owner identity. */
export function xDriveNotesSafeRelativeAsset(value: string): boolean {
  if (!value.startsWith('_assets/') || value.length > 500) return false
  if (value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('%')) return false
  const parts = value.split('/')
  return parts.length >= 3 && parts.every(part =>
    part !== '' && part !== '.' && part !== '..' && !/[\u0000-\u001f\u007f]/.test(part))
}

export function xDriveNotesSafeExternalLink(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
