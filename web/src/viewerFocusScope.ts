/**
 * Keep Tab within the active routed Viewer. Its source Gallery stays mounted
 * behind this fixed overlay; unlike Desktop's MUI Dialog, the frame has no
 * built-in keyboard focus trap. Portaled MUI menus/dialogs own their focus and
 * never bubble Tab through this frame.
 *
 * Return true only when we explicitly moved focus, so ordinary interior Tab
 * order and native video/audio/PDF controls remain browser-managed.
 */
/** Denied optional DOM/style APIs must not crash Viewer keyboard navigation. */
function xDriveFocusViewerTarget(target: HTMLElement): boolean {
  try { target.focus(); return true }
  catch { return false }
}

function xDriveViewerTabCandidate(element: HTMLElement): boolean {
  try {
    // Filmstrip uses roving negative tabIndex even on native buttons.
    const tabIndexAttr = element.getAttribute('tabindex')
    return (tabIndexAttr === null || !(Number(tabIndexAttr) < 0)) &&
      !element.matches(':disabled') &&
      element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden="true"], [inert], [hidden]') &&
      (typeof window === 'undefined' ||
        window.getComputedStyle(element).visibility !== 'hidden')
  } catch {
    // An uninspectable node is never a proven tabbable endpoint.
    return false
  }
}

export function xDriveContainViewerTabFocus(
  root: HTMLElement | null,
  active: Element | null,
  backwards: boolean,
): boolean {
  if (!root || !active) return false
  try {
    if (active !== root && !root.contains(active)) return false
  } catch {
    // An inaccessible focus ancestry cannot license stealing portal focus.
    return false
  }
  let focusable: HTMLElement[]
  try {
    focusable = Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), ' +
      'textarea:not(:disabled), video[controls], audio[controls], iframe, ' +
      '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )).filter(xDriveViewerTabCandidate)
  } catch {
    // The Viewer dialog root is its only verified local fallback.
    return xDriveFocusViewerTarget(root)
  }
  if (focusable.length === 0) return xDriveFocusViewerTarget(root)
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (active === root) return xDriveFocusViewerTarget(backwards ? last : first)
  if (backwards && active === first) return xDriveFocusViewerTarget(last)
  if (!backwards && active === last) return xDriveFocusViewerTarget(first)
  return false
}
