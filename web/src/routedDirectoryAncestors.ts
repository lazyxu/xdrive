/** One disposable, Owner-bound ?dir= ancestor walk in the Web Files shell.
 * No global coordinator or persistent task is touched. The caller owns the
 * AbortSignal and the current navigation intent; neither is persisted.
 */
export type XDriveRoutedDirectoryAncestor = {
  id: number
  name: string
  type: string
  parent_id?: number | null
}

export async function xDriveResolveRoutedDirectoryAncestors<
  TNode extends XDriveRoutedDirectoryAncestor,
>(
  targetID: number,
  readNode: (nodeID: number, signal: AbortSignal) => Promise<TNode>,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<Array<{ id: number; name: string }> | null> {
  const chain: Array<{ id: number; name: string }> = []
  let cursor = targetID
  // Preserve the existing bounded ancestor walk and directory-only check.
  for (let depth = 0; depth < 256; depth += 1) {
    if (signal.aborted || !isCurrent()) return null
    let node: TNode
    try {
      node = await readNode(cursor, signal)
    } catch (error) {
      if (signal.aborted || !isCurrent()) return null
      throw error
    }
    // The old request can settle even when its transport ignores AbortSignal.
    // Never dispatch another obsolete GET, much less commit its breadcrumb.
    if (signal.aborted || !isCurrent()) return null
    if (node.type !== 'dir') throw new Error('目标不是文件夹。')
    chain.push({ id: node.id, name: node.name })
    if (!node.parent_id) break
    cursor = node.parent_id
  }
  chain.reverse()
  return chain
}
