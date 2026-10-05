import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
} from '../server-update'

export type XDriveServerUpdateTransportError = {
  message: string
  status?: number
  code?: string
  detail?: string
}

export type XDriveServerUpdateTransportResult<T> =
  | T
  | { ok: true; data: T }
  | { ok: false; error: XDriveServerUpdateTransportError }

export interface XDriveServerUpdatePort {
  getState: () => Promise<XDriveServerUpdateTransportResult<XDriveServerUpdateState>>
  startUpdate: (
    source: XDriveServerUpdateSource,
    channel: XDriveServerUpdateChannel,
    backupFileData: boolean,
  ) => Promise<XDriveServerUpdateTransportResult<XDriveServerUpdateState>>
}

function isWrappedTransportResult<T>(
  value: XDriveServerUpdateTransportResult<T>,
): value is
  | { ok: true; data: T }
  | { ok: false; error: XDriveServerUpdateTransportError } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    ('data' in value || 'error' in value),
  )
}

function transportError(error: XDriveServerUpdateTransportError) {
  const result = new Error(error.message) as Error & {
    status?: number
    code?: string
    detail?: string
  }
  result.status = error.status
  result.code = error.code
  result.detail = error.detail
  return result
}

async function resolveTransport<T>(
  value: Promise<XDriveServerUpdateTransportResult<T>>,
): Promise<T> {
  const result = await value
  if (!isWrappedTransportResult(result)) return result
  if (result.ok) return result.data
  throw transportError(result.error)
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback
}

function updateActive(state: XDriveServerUpdateState | null) {
  return state?.state === 'queued' || state?.state === 'running'
}

export function useXDriveServerUpdateController({
  open,
  enabled = true,
  supported = true,
  initialSource = 'github',
  initialChannel = 'stable',
  port,
  pollIntervalMs = 2_000,
  unsupportedMessage = '当前客户端不支持服务端更新。',
  forbiddenMessage = '仅管理员可以更新服务端。',
  loadErrorMessage = '无法读取服务端更新状态。',
  activeReconnectMessage = '服务端更新期间连接可能暂时中断，正在等待服务恢复…',
  onBusyChange,
}: {
  open: boolean
  enabled?: boolean
  supported?: boolean
  initialSource?: XDriveServerUpdateSource
  initialChannel?: XDriveServerUpdateChannel
  port: XDriveServerUpdatePort
  pollIntervalMs?: number
  unsupportedMessage?: string
  forbiddenMessage?: string
  loadErrorMessage?: string
  activeReconnectMessage?: string
  onBusyChange?: (busy: boolean) => void
}) {
  const [state, setState] = useState<XDriveServerUpdateState | null>(null)
  const [source, setSource] = useState<XDriveServerUpdateSource>(initialSource)
  const [channel, setChannel] = useState<XDriveServerUpdateChannel>(initialChannel)
  const [backupFileData, setBackupFileData] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const initializedRef = useRef(false)
  const stateRef = useRef<XDriveServerUpdateState | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (initializedRef.current) return
    setSource(initialSource)
    setChannel(initialChannel)
  }, [initialChannel, initialSource])

  const applyState = useCallback((next: XDriveServerUpdateState) => {
    if (!initializedRef.current) {
      initializedRef.current = true
      setSource(next.source)
      setChannel(next.channel)
    }
    setState(next)
    setError('')
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || !supported) return null
    try {
      const next = await resolveTransport(port.getState())
      applyState(next)
      return next
    } catch (refreshError) {
      if (errorStatus(refreshError) === 403) {
        const unavailable: XDriveServerUpdateState = {
          supported: false,
          state: 'unavailable',
          source,
          channel,
          message: forbiddenMessage,
        }
        setState(unavailable)
        setError('')
        return unavailable
      }
      setError(
        updateActive(stateRef.current)
          ? activeReconnectMessage
          : errorMessage(refreshError, loadErrorMessage),
      )
      return null
    }
  }, [
    activeReconnectMessage,
    applyState,
    channel,
    enabled,
    forbiddenMessage,
    loadErrorMessage,
    port,
    source,
    supported,
  ])

  useEffect(() => {
    if (!open || !enabled) return
    if (!supported) {
      setState({
        supported: false,
        state: 'unavailable',
        source,
        channel,
        message: unsupportedMessage,
      })
      setError('')
      return
    }

    let active = true
    const poll = async () => {
      if (!active) return
      await refresh()
    }
    void poll()
    const timer = globalThis.setInterval(() => void poll(), pollIntervalMs)
    return () => {
      active = false
      globalThis.clearInterval(timer)
    }
  }, [
    channel,
    enabled,
    open,
    pollIntervalMs,
    refresh,
    source,
    supported,
    unsupportedMessage,
  ])

  const start = useCallback(async () => {
    if (!enabled || !supported || busy) return null
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    try {
      const next = await resolveTransport(
        port.startUpdate(source, channel, backupFileData),
      )
      applyState(next)
      return next
    } catch (startError) {
      setError(errorMessage(startError, '提交服务端更新失败。'))
      return null
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }, [
    applyState,
    backupFileData,
    busy,
    channel,
    enabled,
    onBusyChange,
    port,
    source,
    supported,
  ])

  return {
    state,
    source,
    channel,
    backupFileData,
    busy,
    error,
    setSource,
    setChannel,
    setBackupFileData,
    refresh,
    start,
  }
}
