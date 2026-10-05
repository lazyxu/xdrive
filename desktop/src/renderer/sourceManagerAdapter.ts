import {
  createXDriveSourceManagerAdapter,
  resolveXDriveSourceManagerTransport,
} from '@xdrive/ui/mui'
import type {
  XDriveSourceManagerPort,
  XDriveSourceTargetBrowser,
  XDriveSourceTargetNode,
} from '@xdrive/ui/mui'

function desktopSourceManagerPort(): XDriveSourceManagerPort {
  const agent = window.xdriveDesktop.agent
  return {
    sources: () => agent.getSources(),
    sourceCredentialStatus: (sourceID) => agent.getSourceCredential(sourceID),
    createSource: (input) => agent.createSource(input),
    triggerSource: (sourceID) => agent.triggerSource(sourceID),
    sourceRuns: (sourceID, limit, offset) => agent.getSourceRuns(sourceID, limit, offset),
    sourceRunFailures: (sourceID, runID, limit, offset) =>
      agent.getSourceRunFailures(sourceID, runID, limit, offset),
    cancelSourceRun: (sourceID, runID) => agent.cancelSourceRun(sourceID, runID),
    sourceItems: (sourceID, state, limit, offset) =>
      agent.getSourceItems(sourceID, state, limit, offset),
    sourceCollections: (sourceID, state) => agent.getSourceCollections(sourceID, state),
    sourceCollectionItems: (sourceID, collectionID, limit, offset) =>
      agent.getSourceCollectionItems(sourceID, collectionID, limit, offset),
    revealSourceCredential: (sourceID) => agent.revealSourceCredential(sourceID),
    testSourceCredential: (kind, payload) => agent.testSourceCredential(
      kind,
      payload as Record<string, string>,
    ),
    testStoredSourceCredential: (sourceID) => agent.testStoredSourceCredential(sourceID),
    updateSource: (sourceID, revision, input) => agent.updateSource(sourceID, revision, input),
    deleteSource: (sourceID, revision) => agent.deleteSource(sourceID, revision),
    setSourceCredential: (sourceID, payload) => agent.setSourceCredential(
      sourceID,
      payload as Record<string, string>,
    ),
    deleteSourceCredential: (sourceID) => agent.deleteSourceCredential(sourceID),
    sourceConnectorConfig: (sourceID) => agent.getSourceConnectorConfig(sourceID),
    sourceBrowseDirectories: (sourceID, path, limit, offset) =>
      agent.browseSourceDirectories(sourceID, path, limit, offset),
    setSourceConnectorConfig: (sourceID, revision, payload) =>
      agent.setSourceConnectorConfig(sourceID, revision, payload),
  }
}

export function createDesktopSourceManagerAdapter(username?: string) {
  return createXDriveSourceManagerAdapter(
    desktopSourceManagerPort(),
    { username },
  )
}

function targetNode(node: AgentCloudNode): XDriveSourceTargetNode {
  return {
    id: node.id,
    name: node.name,
  }
}

export const desktopSourceTargetBrowser: XDriveSourceTargetBrowser = {
  async root() {
    const root = await resolveXDriveSourceManagerTransport(
      window.xdriveDesktop.agent.cloudRoot(),
    )
    return {
      ...targetNode(root),
      name: '我的文件',
    }
  },

  async children(parentID) {
    const children = await resolveXDriveSourceManagerTransport(
      window.xdriveDesktop.agent.cloudChildren(parentID),
    )
    return children
      .filter((node) => node.type === 'dir')
      .map(targetNode)
  },
}
