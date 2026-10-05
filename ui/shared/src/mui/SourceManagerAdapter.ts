import { externalSourceConnectorProfile } from '../external-sources'
import type {
  CreateExternalSourceInput,
  ExternalSource,
  ExternalSourceBrowsePage,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceConnectorConfig,
  ExternalSourceCredentialReveal,
  ExternalSourceCredentialStatus,
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceOverview,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  UpdateExternalSourceInput,
} from '../external-sources'
import type { XDriveSourceManagerAdapter } from './SourceManager'

export type XDriveSourceManagerTransportError = {
  message: string
  code?: string
  detail?: string
}

export type XDriveSourceManagerTransportResult<T> =
  | T
  | { ok: true; data: T }
  | { ok: false; error: XDriveSourceManagerTransportError }

export interface XDriveSourceManagerPort {
  me?: () => Promise<XDriveSourceManagerTransportResult<{ username: string }>>
  sourceOverview?: () => Promise<XDriveSourceManagerTransportResult<ExternalSourceOverview[]>>
  sources?: () => Promise<XDriveSourceManagerTransportResult<ExternalSource[]>>
  sourceCredentialStatus?: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCredentialStatus>>
  createSource: (
    input: CreateExternalSourceInput,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSource>>
  triggerSource: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSource>>
  sourceRuns: (
    sourceID: number,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceRun[]>>
  sourceRunFailures: (
    sourceID: number,
    runID: string,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceRunFailure[]>>
  cancelSourceRun: (
    sourceID: number,
    runID: string,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceRun>>
  sourceItems: (
    sourceID: number,
    state?: string,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceItem[]>>
  sourceCollections: (
    sourceID: number,
    state?: string,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCollection[]>>
  sourceCollectionItems: (
    sourceID: number,
    collectionID: number,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCollectionItem[]>>
  revealSourceCredential: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCredentialReveal>>
  testSourceCredential: (
    kind: string,
    payload: Record<string, unknown>,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCredentialTestResult>>
  testStoredSourceCredential: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCredentialTestResult>>
  updateSource: (
    sourceID: number,
    revision: number,
    input: UpdateExternalSourceInput,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSource>>
  deleteSource: (
    sourceID: number,
    revision: number,
  ) => Promise<XDriveSourceManagerTransportResult<unknown>>
  setSourceCredential: (
    sourceID: number,
    payload: Record<string, unknown>,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceCredentialStatus>>
  deleteSourceCredential: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<unknown>>
  sourceConnectorConfig: (
    sourceID: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceConnectorConfig>>
  sourceBrowseDirectories: (
    sourceID: number,
    path?: string,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceBrowsePage>>
  setSourceConnectorConfig: (
    sourceID: number,
    revision: number,
    payload: Record<string, unknown>,
  ) => Promise<XDriveSourceManagerTransportResult<ExternalSourceConnectorConfig>>
}

function isWrappedTransportResult<T>(
  value: XDriveSourceManagerTransportResult<T>,
): value is
  | { ok: true; data: T }
  | { ok: false; error: XDriveSourceManagerTransportError } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    ('data' in value || 'error' in value),
  )
}

function transportError(error: XDriveSourceManagerTransportError) {
  const result = new Error(error.message) as Error & {
    code?: string
    detail?: string
  }
  result.code = error.code
  result.detail = error.detail
  return result
}

export async function resolveXDriveSourceManagerTransport<T>(
  value: Promise<XDriveSourceManagerTransportResult<T>>,
): Promise<T> {
  const result = await value
  if (!isWrappedTransportResult(result)) return result
  if (!result.ok) throw transportError(result.error)
  return result.data
}

async function resolveOptionalTransport<T>(
  value: Promise<XDriveSourceManagerTransportResult<T>>,
): Promise<T | undefined> {
  const result = await value
  if (!isWrappedTransportResult(result)) return result
  return result.ok ? result.data : undefined
}

async function synthesizedSourceOverview(
  port: XDriveSourceManagerPort,
): Promise<ExternalSourceOverview[]> {
  if (!port.sources) {
    throw new Error('SourceManager port must provide sourceOverview() or sources().')
  }
  const sources = await resolveXDriveSourceManagerTransport(port.sources())
  return Promise.all(sources.map(async (source) => {
    const [runs, credential] = await Promise.all([
      resolveOptionalTransport(port.sourceRuns(source.id, 1)),
      externalSourceConnectorProfile(source.kind, source.direction).credential &&
      port.sourceCredentialStatus
        ? resolveOptionalTransport(port.sourceCredentialStatus(source.id))
        : Promise.resolve(undefined),
    ])
    return {
      source,
      latest_run: runs?.[0],
      credential,
    }
  }))
}

export function createXDriveSourceManagerAdapter(
  port: XDriveSourceManagerPort,
  { username }: { username?: string } = {},
): XDriveSourceManagerAdapter {
  return {
    me: username
      ? async () => ({ username })
      : port.me
        ? () => resolveXDriveSourceManagerTransport(port.me!())
        : undefined,
    sourceOverview: () => port.sourceOverview
      ? resolveXDriveSourceManagerTransport(port.sourceOverview())
      : synthesizedSourceOverview(port),
    createSource: (input) => resolveXDriveSourceManagerTransport(port.createSource(input)),
    triggerSource: (sourceID) => resolveXDriveSourceManagerTransport(port.triggerSource(sourceID)),
    sourceRuns: (sourceID, limit, offset) => resolveXDriveSourceManagerTransport(
      port.sourceRuns(sourceID, limit, offset),
    ),
    sourceRunFailures: (sourceID, runID, limit, offset) => resolveXDriveSourceManagerTransport(
      port.sourceRunFailures(sourceID, runID, limit, offset),
    ),
    cancelSourceRun: (sourceID, runID) => resolveXDriveSourceManagerTransport(
      port.cancelSourceRun(sourceID, runID),
    ),
    sourceItems: (sourceID, state, limit, offset) => resolveXDriveSourceManagerTransport(
      port.sourceItems(sourceID, state, limit, offset),
    ),
    sourceCollections: (sourceID, state) => resolveXDriveSourceManagerTransport(
      port.sourceCollections(sourceID, state),
    ),
    sourceCollectionItems: (sourceID, collectionID, limit, offset) =>
      resolveXDriveSourceManagerTransport(
        port.sourceCollectionItems(sourceID, collectionID, limit, offset),
      ),
    revealSourceCredential: (sourceID) => resolveXDriveSourceManagerTransport(
      port.revealSourceCredential(sourceID),
    ),
    testSourceCredential: (kind, payload) => resolveXDriveSourceManagerTransport(
      port.testSourceCredential(kind, payload),
    ),
    testStoredSourceCredential: (sourceID) => resolveXDriveSourceManagerTransport(
      port.testStoredSourceCredential(sourceID),
    ),
    updateSource: (sourceID, revision, input) => resolveXDriveSourceManagerTransport(
      port.updateSource(sourceID, revision, input),
    ),
    deleteSource: async (sourceID, revision) => {
      await resolveXDriveSourceManagerTransport(port.deleteSource(sourceID, revision))
    },
    setSourceCredential: (sourceID, payload) => resolveXDriveSourceManagerTransport(
      port.setSourceCredential(sourceID, payload),
    ),
    deleteSourceCredential: async (sourceID) => {
      await resolveXDriveSourceManagerTransport(port.deleteSourceCredential(sourceID))
    },
    sourceConnectorConfig: (sourceID) => resolveXDriveSourceManagerTransport(
      port.sourceConnectorConfig(sourceID),
    ),
    sourceBrowseDirectories: (sourceID, path, limit, offset) =>
      resolveXDriveSourceManagerTransport(
        port.sourceBrowseDirectories(sourceID, path, limit, offset),
      ),
    setSourceConnectorConfig: (sourceID, revision, payload) =>
      resolveXDriveSourceManagerTransport(
        port.setSourceConnectorConfig(sourceID, revision, payload),
      ),
  }
}
