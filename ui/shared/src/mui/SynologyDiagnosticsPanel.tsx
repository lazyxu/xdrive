import { useEffect, useState } from 'react'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveDiagnosticReport } from './DiagnosticsPage'
import { XDriveDiagnosticsPage } from './DiagnosticsPage'
import { XDriveStatusAlert } from './StatusAlert'

// DSM renders the same diagnostics page as Desktop; only the transport differs.
export function XDriveSynologyDiagnosticsPanel({ client }: {
  client: XDriveSynologyBackupLocalClient
}) {
  const [report, setReport] = useState<XDriveDiagnosticReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setLoading(true)
    setReport(null) // Never retain an old successful session after failure.
    setError('')
    void client.diagnostics(abort.signal).then((data) => {
      if (active) setReport(data)
    }).catch(() => {
      if (active) setError('当前 DSM 授权或本机备份 Agent 接口不可访问；未完成诊断。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false; abort.abort() }
  }, [client, revision])
  return (
    <>
      {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
      <XDriveDiagnosticsPage
        diagnostics={report}
        busy={loading ? 'diagnostics' : ''}
        paused={false}
        onRun={() => setRevision((value) => value + 1)}
        scopeNotice="NAS 仅检测 DSM 登录授权和本机备份 Agent 读取；Server、磁盘、更新、传输等未检测。"
      />
    </>
  )
}
