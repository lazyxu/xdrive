import type { XDriveDiagnosticCheck, XDriveDiagnosticReport } from './mui/DiagnosticsPage'
import type { XDriveSynologyBackupLocalClient } from './synology-backup-adapter'

type DSMOwnerDiagnosticsPort = Pick<
  XDriveSynologyBackupLocalClient, 'diagnostics' | 'serverConnection' | 'ownerQuota'
>

/**
 * Show whether this DSM's original Agent can actually read the current Server
 * Owner, not merely whether the local NAS backup IPC is alive. This uses only
 * existing authenticated, read-only CGI methods; no Server health guess, new
 * credential surface, or standalone DSM diagnostics page.
 */
export async function xDriveSynologyReadOwnerLoginDiagnostics(
  client: DSMOwnerDiagnosticsPort,
  signal?: AbortSignal,
): Promise<XDriveDiagnosticReport> {
  const ensureCurrent = () => {
    if (signal?.aborted) throw new Error('DSM diagnostics cancelled')
  }
  // Retain the local checks even if Server login is missing or offline.
  const local = await client.diagnostics(signal)
  ensureCurrent()

  let login: XDriveDiagnosticCheck = {
    name: 'login session',
    status: 'WARN',
    detail: 'Server Owner verification unavailable',
  }
  try {
    const before = await client.serverConnection(signal)
    ensureCurrent()
    if (!before.configured) {
      login = { name: 'login session', status: 'WARN', detail: 'Server Owner login not configured' }
    } else if (before.must_change_password) {
      login = { name: 'login session', status: 'WARN', detail: 'Server Owner password change required' }
    } else {
      // A configured URL is not evidence that login is usable. The original
      // Agent's quota read makes a real Owner-authorized Server request.
      await client.ownerQuota(signal)
      ensureCurrent()
      const after = await client.serverConnection(signal)
      ensureCurrent()
      // Avoid a green result if Owner/server changed during the live probe.
      if (before.owner_scope && before.owner_scope === after.owner_scope &&
          before.server === after.server && before.username === after.username &&
          after.configured && !after.must_change_password) {
        login = {
          name: 'login session',
          status: 'PASS',
          detail: 'Current Server Owner quota read through authenticated Agent',
        }
      } else {
        login = { name: 'login session', status: 'WARN', detail: 'Server Owner changed during check' }
      }
    }
  } catch {
    // Network, expired credentials and optional older Agent capabilities are
    // genuine WARNs, not evidence that the local DSM Agent itself failed.
    // Do not expose raw Server errors, addresses, user names or tokens.
    ensureCurrent()
  }

  ensureCurrent()
  return {
    ...local,
    checks: [...local.checks, login],
    summary: {
      pass: local.summary.pass + Number(login.status === 'PASS'),
      warn: local.summary.warn + Number(login.status === 'WARN'),
      fail: local.summary.fail + Number(login.status === 'FAIL'),
    },
  }
}
