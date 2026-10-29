/**
 * One Host-neutral admission transition for the shared compact navigation.
 * Initial render is not a transition: a caller may intentionally mount the
 * controlled More/fullscreen drawer already open. Callback identity updates
 * must not evict that open state either.
 */
export type XDriveCompactNavigationAdmission = Readonly<{
  selected?: string
  disabled: boolean
}>

export function xDriveCompactNavigationAdmissionChanged(
  previous: XDriveCompactNavigationAdmission,
  next: XDriveCompactNavigationAdmission,
): boolean {
  return previous.selected !== next.selected || previous.disabled !== next.disabled
}
