import type { XDriveClipboardDataPort } from '../../../ui/shared/src/mui/ClipboardPage'
import { XDriveDesktopClipboardObservationGate } from './desktopClipboardObservationGate'

// Desktop never receives a Server bearer. The selected authenticated Agent
// owns each narrow operation; automatic OS polling is strictly opt-in and page-bound.
export function createDesktopClipboardDataPort(
  agent: Pick<Window['xdriveDesktop']['agent'],
    'cloudClipboardList' |
    'cloudClipboardCreate' | 'cloudClipboardDelete' | 'cloudClipboardClear' |
    'cloudClipboardDevices' | 'cloudClipboardEnableDevice' |
    'cloudClipboardRevokeDevice'>,
  ownerScopeKey: string,
  _server: string,
  ownerCurrent: () => boolean,
  openVerifiedFile?: (nodeID: number, signal: AbortSignal) => Promise<void>,
): XDriveClipboardDataPort {
  const verify = (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (!ownerCurrent()) throw new Error('Desktop 账号已变化，请重新打开剪贴板。')
  }
  const unwrap = <T,>(result: DesktopResult<T>): T => {
    if (!result.ok) throw new Error(result.error.message || 'Agent Clipboard 请求失败')
    return result.data
  }
  const run = async <T,>(perform: () => Promise<DesktopResult<T>>, signal?: AbortSignal) => {
    verify(signal)
    const result = await perform()
    verify(signal)
    return unwrap(result)
  }
  const observation = new XDriveDesktopClipboardObservationGate()
  return {
    ownerScopeKey,
    list: (before, signal) => run(() => agent.cloudClipboardList(before ?? 0), signal),
    listDevices: signal => run(() => agent.cloudClipboardDevices(), signal),
    enableDeviceRecipient: signal => run(() => agent.cloudClipboardEnableDevice(), signal),
    revokeDevice: (id, signal) => run(() => agent.cloudClipboardRevokeDevice(id), signal),
    openReferencedFile: openVerifiedFile ? async (nodeID, signal) => {
      if (!Number.isSafeInteger(nodeID) || nodeID <= 0)
        throw new Error('invalid Clipboard file reference')
      verify(signal)
      await openVerifiedFile(nodeID, signal)
      // A successful, explicit Clipboard -> Files route transition unmounts
      // Clipboard and cancels its page-scoped action signal. Keep the Owner
      // check, but never mistake this expected disposal for an authorization
      // failure after the verified Files handoff has already been admitted.
      verify()
    } : undefined,
    create: (value, signal) => {
      const media = value.kind === 'image/x-xdrive-node-ref' ||
        value.kind === 'application/x-xdrive-node-ref'
      if ((media && (!value.target_device_id || !value.node_id ||
          value.content !== 'asset:' + value.node_id)) ||
          (!media && !!value.node_id)) {
        throw new Error('Desktop Clipboard 内容与目标设备不匹配')
      }
      return run(() => agent.cloudClipboardCreate(value), signal)
    },
    remove: (id, signal) => run(() => agent.cloudClipboardDelete(id), signal),
    clear: signal => run(() => agent.cloudClipboardClear(), signal),
    readText: async () => {
      verify()
      const text = window.xdriveDesktop.readClipboardText()
      verify()
      return text
    },
    watchLocalClipboard: async (onChange, signal) => {
      verify(signal)
      observation.reset() // Never send the clipboard contents present on enable.
      const delay = () => new Promise<void>(resolve => {
        const done = () => { window.clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = window.setTimeout(done, 1000)
        signal.addEventListener('abort', done, { once: true })
      })
      try {
        while (!signal.aborted) {
          verify(signal)
          if (document.visibilityState === 'visible') {
            const observed = observation.consider(window.xdriveDesktop.readClipboardText(), true)
            verify(signal)
            if (observed !== null) await onChange(observed)
          }
          await delay()
        }
      } finally { observation.reset() }
    },
    copyText: async text => {
      verify()
      observation.suppressLocalWrite(text)
      window.xdriveDesktop.copyText(text)
      verify()
    },
  }
}
