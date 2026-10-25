/**
 * Keep Tab within the active routed Viewer. Its source Gallery stays mounted
 * behind this fixed overlay; unlike Desktop's MUI Dialog, the frame has no
 * built-in keyboard focus trap. Portaled MUI menus/dialogs own their focus and
 * never bubble Tab through this frame.
 *
 * Return true only when we explicitly moved focus, so ordinary interior Tab
 * order and native video/audio/PDF controls remain browser-managed.
 */
export function xDriveContainViewerTabFocus(
  root: HTMLElement | null,
  active: Element | null,
  backwards: boolean,
): boolean {
  if (!root || !active || (active !== root && !root.contains(active))) return false
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), ' +
    'textarea:not(:disabled), video[controls], audio[controls], iframe, ' +
    '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
  )).filter((element) => {
    // MUI Filmstrip uses roving tabIndex=-1 on nonactive thumbnails.
    // button:not(:disabled) still matches those nodes; without this guard
    // they become false first/last Tab stops and allow focus to escape.
    const tabIndexAttr = element.getAttribute('tabindex')
    return (tabIndexAttr === null || !(Number(tabIndexAttr) < 0)) &&
      !element.matches(':disabled') &&
      element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden="true"], [inert], [hidden]') &&
      (typeof window === 'undefined' || window.getComputedStyle(element).visibility !== 'hidden')
  })
  if (focusable.length === 0) {
    root.focus()
    return true
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (active === root) {
    (backwards ? last : first).focus()
    return true
  }
  if (backwards && active === first) {
    last.focus()
    return true
  }
  if (!backwards && active === last) {
    first.focus()
    return true
  }
  return false
}
