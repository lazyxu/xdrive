export type XDriveDesktopFileExplorerPathCrumb = Readonly<{
  name: string
}>

export type XDriveDesktopFileExplorerPathNode = Readonly<{
  name: string
}>

/**
 * Resolve a cloud node to a path under the configured local sync root.
 *
 * Search results carry their own Server-authoritative root-relative path.
 * Ordinary rows must use the active workspace tab's breadcrumbs: the
 * component props only describe the initial route and can be stale after
 * navigating inside another tab.
 */
export function xDriveDesktopFileExplorerRelativePath(
  node: XDriveDesktopFileExplorerPathNode,
  searchPath: string | undefined,
  activeCrumbs: readonly XDriveDesktopFileExplorerPathCrumb[],
): string {
  if (searchPath) return searchPath
  return [...activeCrumbs.slice(1).map((crumb) => crumb.name), node.name].join('/')
}
