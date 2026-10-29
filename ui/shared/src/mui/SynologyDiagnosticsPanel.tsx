import { useMemo } from 'react'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import { XDriveDiagnosticsHostController } from './DiagnosticsHostController'
import type { XDriveDiagnosticsReadSource } from './DiagnosticsHostController'

/**
 * Backward-compatible DSM adapter for callers that still mount it directly.
 * Main DSM routing now uses the same explicit diagnosticsSource contract as
 * every Host, without a second page or data-fetch controller.
 */
export function XDriveSynologyDiagnosticsPanel({ client }: {
  client: XDriveSynologyBackupLocalClient
}) {
  const source = useMemo<XDriveDiagnosticsReadSource>(() => ({
    read: signal => client.diagnostics(signal),
    scopeNotice: 'NAS 仅检测 DSM 登录授权和本机备份 Agent 读取；Server、磁盘、更新、传输等未检测。',
    failureMessage: '当前 DSM 授权或本机备份 Agent 接口不可访问；未完成诊断。',
  }), [client])
  return <XDriveDiagnosticsHostController source={source} />
}
