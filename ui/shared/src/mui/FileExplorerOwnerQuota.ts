import { useEffect, useState } from 'react'

/**
 * The shared Files shell may show a quota alert only after a real authorized
 * Owner read. A failed, cancelled or superseded quota request is *unknown*,
 * never a verified zero/false. This hook supplies no privileged transport,
 * credentials, quota synthesis, or mutation callback.
 */
export type XDriveFileExplorerOwnerQuotaPort = {
  ownerQuota: (signal: AbortSignal) => Promise<{ over_quota: boolean }>
}

type VerifiedOwnerQuota<TPort> = {
  port: TPort
  revision: number
  overQuota: boolean | null
}

export function useXDriveFileExplorerOwnerQuota<
  TPort extends XDriveFileExplorerOwnerQuotaPort,
>(port: TPort, revision: number): boolean | null {
  const [state, setState] = useState<VerifiedOwnerQuota<TPort> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState(null)
    void port.ownerQuota(controller.signal).then(quota => {
      if (!active || controller.signal.aborted) return
      // Host must have verified the Server Owner response; never infer false.
      if (typeof quota?.over_quota !== 'boolean') {
        setState({ port, revision, overQuota: null })
        return
      }
      setState({ port, revision, overQuota: quota.over_quota })
    }).catch(() => {
      if (active && !controller.signal.aborted) {
        setState({ port, revision, overQuota: null })
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [port, revision])

  // Fence changes during render, before passive cleanup, so no previous
  // account or root revision may display a stale quota warning.
  return state?.port === port && state.revision === revision
    ? state.overQuota : null
}
