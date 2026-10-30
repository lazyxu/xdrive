import type { NodeLocation } from '../models'

/** A shape-only, read-only projection of a current authenticated NodeLocation. */
export type XDriveFileExplorerLocationAncestors = Array<{
  id: number
  name: string
}>

/**
 * Web and Desktop must navigate only an actual, internally consistent
 * containing-folder chain returned by their current Server/Agent read port.
 * A response's `path`, Source roots, provider secrets, and local paths are
 * never published in these FileExplorer breadcrumbs.
 *
 * This is NOT Host/Owner authorization: the real Host still verifies every
 * location and the target folder's new first Range must be accepted before
 * either caller requests the exact child reveal.
 */
export function xDriveFileExplorerLocationAncestorCrumbs(
  location: Pick<NodeLocation, 'parent_id' | 'node_id' | 'breadcrumbs'>,
): XDriveFileExplorerLocationAncestors | null {
  if (!location || !Number.isSafeInteger(location.node_id) ||
      location.node_id <= 0 || !Number.isSafeInteger(location.parent_id) ||
      !location.parent_id || location.parent_id <= 0 ||
      location.parent_id === location.node_id ||
      !Array.isArray(location.breadcrumbs) ||
      location.breadcrumbs.length === 0 ||
      location.breadcrumbs.length > 256) return null

  const seen = new Set<number>()
  const ancestors: Array<{ id: number; name: string }> = []
  for (const crumb of location.breadcrumbs) {
    if (!crumb || !Number.isSafeInteger(crumb.id) || crumb.id <= 0 ||
        typeof crumb.name !== 'string' ||
        crumb.name.trim().length === 0 || crumb.name.length > 512 ||
        /[\x00-\x1f\x7f]/.test(crumb.name) ||
        seen.has(crumb.id)) return null
    seen.add(crumb.id)
    if (crumb.id !== location.node_id) {
      ancestors.push({ id: crumb.id, name: crumb.name })
    }
  }
  // Missing or displaced parents are unverified. The file's own breadcrumb,
  // when supplied, must be the final member and not another ancestor.
  if (seen.has(location.node_id) &&
      location.breadcrumbs[location.breadcrumbs.length - 1]?.id !== location.node_id) {
    return null
  }
  return ancestors.length > 0 &&
    ancestors[ancestors.length - 1].id === location.parent_id
      ? ancestors : null
}
