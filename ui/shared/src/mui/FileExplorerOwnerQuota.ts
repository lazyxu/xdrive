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
>(
  port: TPort, revision: number, authenticatedRootCurrent: boolean,
): boolean | null {
  const [state, setState] = useState<VerifiedOwnerQuota<TPort> | null>(null)

  useEffect(() => {
    // Owner quota is not a bootstrap permission: do not query it until the
    // current Host's authenticated Owner root has passed the real root read.
    // After a Host/root replacement, hide previous quota synchronously.
    if (!authenticatedRootCurrent) {
      setState(null)
      return
    }
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
  }, [port, revision, authenticatedRootCurrent])

  // Fence during render, before passive effects clean up. A failed/missing
  // authorized root cannot borrow an earlier Owner's verified quota badge.
  return authenticatedRootCurrent &&
    state?.port === port && state.revision === revision
      ? state.overQuota : null
}
