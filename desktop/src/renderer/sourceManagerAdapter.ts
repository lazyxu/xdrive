import type {
  XDriveSourceManagerAdapter,
  XDriveSourceTargetBrowser,
  XDriveSourceTargetNode,
} from '@xdrive/ui/mui'
import { externalSourceConnectorProfile } from '@xdrive/shared'
import type {
  ExternalSourceCredentialStatus,
  ExternalSourceOverview,
} from '@xdrive/shared'

type AgentFailure = {
  message: string
  code?: string
  detail?: string
}

type AgentResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AgentFailure }

function unwrap<T>(result: AgentResult<T>): T {
  if (result.ok) return result.data
  const error = new Error(result.error.message) as Error & { code?: string; detail?: string }
  error.code = result.error.code
  error.detail = result.error.detail
  throw error
}

function credentialOrUndefined(
  result: AgentResult<ExternalSourceCredentialStatus> | null,
): ExternalSourceCredentialStatus | undefined {
  return result && result.ok ? result.data : undefined
}

export function createDesktopSourceManagerAdapter(
  username?: string,
): XDriveSourceManagerAdapter {
  return {
    me: username ? async () => ({ username }) : undefined,

    async sourceOverview(): Promise<ExternalSourceOverview[]> {
      const sources = unwrap(await window.xdriveDesktop.agent.getSources())
      return Promise.all(sources.map(async (source) => {
        const [runsResult, credentialResult] = await Promise.all([
          window.xdriveDesktop.agent.getSourceRuns(source.id, 1),
          externalSourceConnectorProfile(source.kind, source.direction).credential
            ? window.xdriveDesktop.agent.getSourceCredential(source.id)
            : Promise.resolve(null),
        ])
        return {
          source,
          latest_run: runsResult.ok ? runsResult.data[0] : undefined,
          credential: credentialOrUndefined(credentialResult),
        }
      }))
    },

    async createSource(input) {
      return unwrap(await window.xdriveDesktop.agent.createSource(input))
    },

    async triggerSource(sourceID) {
      return unwrap(await window.xdriveDesktop.agent.triggerSource(sourceID))
    },

    async sourceRuns(sourceID, limit, offset) {
      return unwrap(await window.xdriveDesktop.agent.getSourceRuns(sourceID, limit, offset))
    },

    async sourceRunFailures(sourceID, runID, limit, offset) {
      return unwrap(await window.xdriveDesktop.agent.getSourceRunFailures(sourceID, runID, limit, offset))
    },

    async cancelSourceRun(sourceID, runID) {
      return unwrap(await window.xdriveDesktop.agent.cancelSourceRun(sourceID, runID))
    },

    async sourceItems(sourceID, state, limit, offset) {
      return unwrap(await window.xdriveDesktop.agent.getSourceItems(sourceID, state, limit, offset))
    },

    async sourceCollections(sourceID, state) {
      return unwrap(await window.xdriveDesktop.agent.getSourceCollections(sourceID, state))
    },

    async sourceCollectionItems(sourceID, collectionID, limit, offset) {
      return unwrap(await window.xdriveDesktop.agent.getSourceCollectionItems(sourceID, collectionID, limit, offset))
    },

    async revealSourceCredential(sourceID) {
      return unwrap(await window.xdriveDesktop.agent.revealSourceCredential(sourceID))
    },

    async testSourceCredential(kind, payload) {
      return unwrap(await window.xdriveDesktop.agent.testSourceCredential(
        kind,
        payload as Record<string, string>,
      ))
    },

    async testStoredSourceCredential(sourceID) {
      return unwrap(await window.xdriveDesktop.agent.testStoredSourceCredential(sourceID))
    },

    async updateSource(sourceID, revision, input) {
      return unwrap(await window.xdriveDesktop.agent.updateSource(sourceID, revision, input))
    },

    async deleteSource(sourceID, revision) {
      return unwrap(await window.xdriveDesktop.agent.deleteSource(sourceID, revision))
    },

    async setSourceCredential(sourceID, payload) {
      return unwrap(await window.xdriveDesktop.agent.setSourceCredential(
        sourceID,
        payload as Record<string, string>,
      ))
    },

    async deleteSourceCredential(sourceID) {
      return unwrap(await window.xdriveDesktop.agent.deleteSourceCredential(sourceID))
    },

    async sourceConnectorConfig(sourceID) {
      return unwrap(await window.xdriveDesktop.agent.getSourceConnectorConfig(sourceID))
    },

    async sourceBrowseDirectories(sourceID, path, limit, offset) {
      return unwrap(await window.xdriveDesktop.agent.browseSourceDirectories(sourceID, path, limit, offset))
    },

    async setSourceConnectorConfig(sourceID, revision, payload) {
      return unwrap(await window.xdriveDesktop.agent.setSourceConnectorConfig(sourceID, revision, payload))
    },
  }
}

function targetNode(node: AgentCloudNode): XDriveSourceTargetNode {
  return {
    id: node.id,
    name: node.name,
  }
}

export const desktopSourceTargetBrowser: XDriveSourceTargetBrowser = {
  async root() {
    const root = unwrap(await window.xdriveDesktop.agent.cloudRoot())
    return {
      ...targetNode(root),
      name: '我的文件',
    }
  },

  async children(parentID) {
    const children = unwrap(await window.xdriveDesktop.agent.cloudChildren(parentID))
    return children
      .filter((node) => node.type === 'dir')
      .map(targetNode)
  },
}
