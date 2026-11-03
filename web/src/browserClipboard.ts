/**
 * Copy text from a user-initiated Web action.
 *
 * The asynchronous Clipboard API is unavailable on most HTTP LAN origins.
 * Keep Files > Copy Path usable there via the legacy synchronous selection
 * path, while leaving the browser in charge of clipboard permissions.
 */
export async function xDriveBrowserCopyText(text: string): Promise<void> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (typeof clipboard?.writeText === 'function') {
      await clipboard.writeText(text)
      return
    }
  } catch {
    // A denied/rejected Clipboard API write may still permit the user-gesture
    // selection path. Never treat a rejected write as a successful copy.
  }

  if (typeof document !== 'undefined' && document.body &&
      typeof document.execCommand === 'function') {
    const previousFocus = document.activeElement
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.readOnly = true
    textarea.setAttribute('aria-hidden', 'true')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.width = '1px'
    textarea.style.height = '1px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    try {
      textarea.focus()
      textarea.select()
      textarea.setSelectionRange(0, text.length)
      if (document.execCommand('copy')) return
    } catch {
      // Some embedded browsers deny even the selection-based fallback.
    } finally {
      textarea.remove()
      if (typeof HTMLElement !== 'undefined' &&
          previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        try { previousFocus.focus({ preventScroll: true }) } catch { /* best effort */ }
      }
    }
  }
  throw new Error('当前浏览器无法写入剪贴板。请使用 HTTPS 访问，或手动复制路径。')
}
