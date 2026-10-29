import { useEffect, useState } from 'react'
import type { XDriveDiagnosticReport } from './DiagnosticsPage'
import { XDriveDiagnosticsPage } from './DiagnosticsPage'
import { XDriveStatusAlert } from './StatusAlert'

/**
 * Host-neutral, read-only Diagnostics port. A Host must explicitly grant a
 * scoped diagnostic read; existence of a local backup client is not evidence
 * that this operation is supported or that Server checks have run.
 */
export type XDriveDiagnosticsReadSource = Readonly<{
  read: (signal: AbortSignal) => Promise<XDriveDiagnosticReport>
  scopeNotice: string
  failureMessage: string
}>

/**
 * Identical Diagnostics UI on Desktop and DSM. Only the verified data source
 * varies; this component cannot call Electron or NAS CGI itself.
 * Superseded reads cannot restore results after an Owner/client change.
 */
export function XDriveDiagnosticsHostController({
  source,
}: { source: XDriveDiagnosticsReadSource }) {
  const [report, setReport] = useState<XDriveDiagnosticReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setReport(null)
    setLoading(true)
    setError('')
    void source.read(abort.signal).then(result => {
      if (active && !abort.signal.aborted) setReport(result)
    }).catch(() => {
      // Never echo raw Agent errors, Host paths or identity material.
      if (active && !abort.signal.aborted) setError(source.failureMessage)
    }).finally(() => {
      if (active && !abort.signal.aborted) setLoading(false)
    })
    return () => { active = false; abort.abort() }
  }, [source, revision])

  return (
    <>
      {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
      <XDriveDiagnosticsPage
        diagnostics={report}
        busy={loading ? 'diagnostics' : ''}
        // No repair/reconnect action is provided by this read-only source.
        paused={false}
        onRun={() => setRevision(value => value + 1)}
        scopeNotice={source.scopeNotice}
      />
    </>
  )
}
