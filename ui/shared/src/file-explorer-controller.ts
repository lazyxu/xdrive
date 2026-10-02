import type { Node } from './models'

export type XDriveFileExplorerPathNode = Pick<Node, 'id' | 'name' | 'type'>
export type XDriveFileExplorerPathCrumb = { id: number; name: string }

export function xDriveFileExplorerPathParts(rawPath: string, rootName: string) {
  const parts = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts[0] === rootName || parts[0] === '我的文件') parts.shift()
  return parts
}

export async function xDriveResolveFileExplorerPath<
  TNode extends XDriveFileExplorerPathNode,
>({
  rawPath,
  rootID,
  rootName,
  listChildren,
}: {
  rawPath: string
  rootID: number
  rootName: string
  listChildren: (parentID: number) => Promise<TNode[]>
}): Promise<XDriveFileExplorerPathCrumb[]> {
  const parts = xDriveFileExplorerPathParts(rawPath, rootName)
  let parentID = rootID
  const crumbs: XDriveFileExplorerPathCrumb[] = [{ id: rootID, name: rootName }]

  for (const part of parts) {
    const children = await listChildren(parentID)
    const next = children.find((node) => node.type === 'dir' && node.name === part)
    if (!next) throw new Error(`找不到文件夹：${part}`)
    parentID = next.id
    crumbs.push({ id: next.id, name: next.name })
  }

  return crumbs
}
