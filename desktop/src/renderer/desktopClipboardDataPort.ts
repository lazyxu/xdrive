import type { XDriveClipboardDataPort } from '../../../ui/shared/src/mui/ClipboardPage'
import { XDriveDesktopClipboardObservationGate } from './desktopClipboardObservationGate'

// Desktop never receives a Server bearer. The selected authenticated Agent
// owns each narrow operation; automatic OS polling is strictly opt-in and page-bound.
export function createDesktopClipboardDataPort(
  agent: Pick<Window['xdriveDesktop']['agent'],
    'cloudClipboardVault' | 'cloudClipboardCheck' | 'cloudClipboardList' |
    'cloudClipboardCreate' | 'cloudClipboardDelete' | 'cloudClipboardClear' |
    'cloudClipboardDevices' | 'cloudClipboardEnableDevice' |
    'cloudClipboardDecrypt' | 'cloudClipboardRevokeDevice'>,
  ownerScopeKey: string,
  server: string,
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
    claimScope(vault) {
      const id = vault.owner_id
      if (!Number.isSafeInteger(id) || !id || id <= 0) {
        throw new Error('当前 Agent 未提供经过验证的 Clipboard Owner 身份')
      }
      const url = new URL(server)
      if (url.protocol !== 'https:' || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Desktop Clipboard Server 地址无效')
      }
      return url.origin + ':' + String(id)
    },
    vault: signal => run(() => agent.cloudClipboardVault(), signal),
    initializeCheck: (value, signal) => run(() => agent.cloudClipboardCheck(value), signal),
    list: (before, signal) => run(() => agent.cloudClipboardList(before ?? 0), signal),
    listDevices: signal => run(() => agent.cloudClipboardDevices(), signal),
    enableDeviceRecipient: signal => run(() => agent.cloudClipboardEnableDevice(), signal),
    revokeDevice: (id, signal) => run(() => agent.cloudClipboardRevokeDevice(id), signal),
    openReferencedFile: openVerifiedFile ? async (nodeID, signal) => {
      if (!Number.isSafeInteger(nodeID) || nodeID <= 0)
        throw new Error('invalid Clipboard file reference')
      verify(signal)
      await openVerifiedFile(nodeID, signal)
      verify(signal)
    } : undefined,
    decryptTarget: async (id, signal) => {
      if (!Number.isSafeInteger(id) || id <= 0) throw Error('Invalid Clipboard item ID')
      const result = await run(() => agent.cloudClipboardDecrypt(id), signal)
      if (typeof result.text !== 'string' || !result.text) throw Error('Clipboard decrypt unavailable')
      return result.text
    },
    create: (value, signal) => {
      if (value.target_device_id) {
        if (!/^[0-9a-f-]{36}$/.test(value.target_device_id) ||
            !value.ephemeral_key || !value.wrapped_key ||
            ((value.kind === 'image/x-xdrive-node-ref' ||
              value.kind === 'application/x-xdrive-node-ref') !==
              (Number.isSafeInteger(value.node_id) && (value.node_id ?? 0) > 0))) {
          throw new Error('Desktop 定向消息缺少已验证设备和加密文件身份')
        }
        // Exact encrypted v2 fields are checked again by Main, Agent and
        // Server. No generic proxy or device-credential privilege here.
        return run(() => agent.cloudClipboardCreate(value), signal)
      }
      if ((value.kind !== 'text/plain' && value.kind !== 'text/uri-list') ||
          value.ephemeral_key || value.wrapped_key || value.node_id) {
        throw new Error('Desktop 不允许把定向内容降级为 v1 广播')
      }
      const legacy = { client_event_id: value.client_event_id, kind: value.kind,
        nonce: value.nonce, ciphertext: value.ciphertext }
      return run(() => agent.cloudClipboardCreate(legacy), signal)
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
