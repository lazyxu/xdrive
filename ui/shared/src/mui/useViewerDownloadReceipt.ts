import { useEffect, useState } from 'react'
import { xDriveMediaByteProgressLabel } from './MediaLoadProgress'

/**
 * Desktop-owned Agent Task Center receipt. The client nonce is an unprivileged,
 * cryptographically random correlation value attached by the Agent at Start.
 * No filename/path matching, transient media cache or second transport.
 */
export type XDriveViewerDownloadTask = {
  id: string
  client_request_id?: string
  cloud_node_id?: number
  kind: string
  direction: string
  state: string
  bytes_done: number
  bytes_total: number
  updated_at?: string
}

export type XDriveViewerDownloadReceiptPort = {
  createRequestID: () => string
  subscribe: (listener: (tasks: readonly XDriveViewerDownloadTask[]) => void) => () => void
  snapshot: () => Promise<readonly XDriveViewerDownloadTask[]>
}

type Intent = { owner: object; nodeID: number; requestID: string }
type Observation = { intent: Intent; task: XDriveViewerDownloadTask }

const terminal = (state: string) =>
  state === 'completed' || state === 'cancelled' || state === 'failed' ||
  state === 'handed_off'

/** Never claim browser/Server handoff means a Desktop download was saved. */
export function xDriveViewerAgentTransferLabel(task: XDriveViewerDownloadTask): string {
  const done = Number.isFinite(task.bytes_done) ? Math.max(0, task.bytes_done) : 0
  const total = Number.isFinite(task.bytes_total) && task.bytes_total > 0
    ? task.bytes_total : undefined
  const bytes = (done > 0 || total !== undefined)
    ? xDriveMediaByteProgressLabel(done, total) : ''
  if (task.state === 'completed') return `下载已保存${bytes ? ' · ' + bytes : ''}`
  if (task.state === 'failed') return '下载失败，请在任务中心查看'
  if (task.state === 'cancelled') return '下载已取消'
  if (task.state === 'handed_off') return '下载已交给系统，请确认保存结果'
  if (task.state === 'cancelling') return `正在取消下载${bytes ? ' · ' + bytes : ''}`
  if (task.state === 'queued') return '正在准备下载…'
  return bytes ? '下载中 · ' + bytes : '正在等待下载…'
}

/**
 * Mount only while the shared Gallery Viewer is open. Receiving Task Center
 * bytes updates only this leaf Viewer, never the 100k-item Gallery Page.
 * The parent supplies a brand-new owner object for each node/revision/source.
 */
export function useXDriveViewerDownloadReceipt(
  port: XDriveViewerDownloadReceiptPort | undefined,
  owner: object,
  nodeID: number | undefined,
) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const [observed, setObserved] = useState<Observation | null>(null)
  const current = intent?.owner === owner && intent.nodeID === nodeID ? intent : null

  useEffect(() => {
    if (!port || !current) return
    let active = true
    const accept = (tasks: readonly XDriveViewerDownloadTask[]) => {
      if (!active) return
      const candidate = tasks.find(task =>
        task.client_request_id === current.requestID &&
        task.cloud_node_id === current.nodeID &&
        task.kind === 'download' && task.direction === 'download')
      if (!candidate) return
      setObserved(previous => {
        if (previous?.intent === current) {
          // Snapshot reads may complete after newer Agent transfer events.
          // An old active snapshot cannot rewind a completed receipt.
          if (terminal(previous.task.state) && !terminal(candidate.state)) return previous
          if (Number.isFinite(previous.task.bytes_done) &&
              previous.task.bytes_done > candidate.bytes_done &&
              !terminal(candidate.state)) return previous
          if (previous.task.id === candidate.id &&
              previous.task.state === candidate.state &&
              previous.task.bytes_done === candidate.bytes_done &&
              previous.task.bytes_total === candidate.bytes_total) return previous
        }
        return { intent: current, task: candidate }
      })
    }
    const unsubscribe = port.subscribe(accept)
    void port.snapshot().then(accept).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [port, current])

  const claim = () => {
    if (!port || !nodeID || !Number.isSafeInteger(nodeID) || nodeID <= 0) return undefined
    const requestID = port.createRequestID()
    if (!/^[0-9a-f]{32}$/.test(requestID)) {
      throw new Error('invalid Desktop Viewer download receipt')
    }
    const next = { owner, nodeID, requestID }
    setIntent(next)
    setObserved(null)
    return requestID
  }
  const dismiss = (requestID?: string) => {
    if (!requestID) return
    setIntent(previous => previous?.requestID === requestID &&
      previous.owner === owner && previous.nodeID === nodeID ? null : previous)
  }
  const task = observed?.intent === current ? observed.task : null
  return {
    claim,
    dismiss,
    text: current ? task ? xDriveViewerAgentTransferLabel(task) : '正在准备下载…' : '',
    announce: Boolean(task && terminal(task.state)),
  }
}
