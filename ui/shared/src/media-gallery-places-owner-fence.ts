/** Render-time Owner admission for trusted map Photos/Drawer pixels.
 * The photo filter key is not an identity: two different Owners may have
 * identical filters. The old Owner's pixels must become inert/hidden during
 * the render of a new Owner, before map effect cleanup has run.
 */
export type XDrivePlacesAcceptedOwnerScope = Readonly<{
  owner: string
  key: string
}>

export function xDrivePlacesSignedScopeIsCurrent(
  accepted: XDrivePlacesAcceptedOwnerScope | null | undefined,
  owner: string | null | undefined,
  filterKey: string,
): boolean {
  return Boolean(accepted && accepted.owner === (owner ?? '') &&
    accepted.key === filterKey)
}
