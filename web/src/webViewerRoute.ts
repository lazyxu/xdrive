import { xDriveClassifyFilePreview } from '../../ui/shared/src/file-preview'
import type { Node } from '../../ui/shared/src/models'
import type { XDriveWebAppRoute } from '../../ui/shared/src/web-app'

// Same original classification logic, moved out of the heavy Viewer component
// so normal App.tsx can route files without eagerly importing all media viewers.
export function xDriveWebOpenRouteForNode(node: Node, contextID?: string): XDriveWebAppRoute | null {
  const kind = xDriveClassifyFilePreview({
    name: node.name,
    kind: node.type,
  })
  if (node.type === 'dir') return { app: 'files', params: { dir: node.id } }
  if (kind === 'image' || kind === 'video' || kind === 'live_photo') {
    return { app: 'media-viewer', params: { node: node.id, context: contextID } }
  }
  if (kind === 'text') return { app: 'text-viewer', params: { node: node.id } }
  if (kind === 'pdf') return { app: 'pdf-viewer', params: { node: node.id } }
  if (kind === 'audio') return { app: 'audio-player', params: { node: node.id } }
  return null
}
