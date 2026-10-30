import type { XDriveCloudFilesRange } from '../cloud-files'

/**
 * A counted Files first page is not accepted just because a Host answered.
 * The initial 0-offset Range must carry an authoritative, internally
 * consistent count before the shared controller publishes any rows/crumbs.
 *
 * This is shape admission only. Server/Agent Owner/Root authorization and
 * the genuine read port remain mandatory on every request.
 */
export function xDriveAdmitCloudFilesCountedFirstPage<TNode extends { id: number }>(
  page: XDriveCloudFilesRange<TNode>,
): XDriveCloudFilesRange<TNode> {
  if (!page || !Array.isArray(page.items) ||
      page.total_count_included === false ||
      !Number.isSafeInteger(page.total_count) ||
      page.total_count < page.items.length ||
      !Number.isSafeInteger(page.offset) || page.offset !== 0 ||
      !Number.isSafeInteger(page.limit) || page.limit <= 0 ||
      page.items.length > page.limit ||
      (page.total_count > 0 && page.items.length === 0)) {
    throw new Error('Unverified Files first counted Range')
  }
  // Do not fabricate a count, list, scope, Owner receipt or new page object.
  return page
}
