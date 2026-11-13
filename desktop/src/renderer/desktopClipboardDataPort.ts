import type { XDriveClipboardDataPort } from '../../../ui/shared/src/mui/ClipboardPage'
import { XDriveDesktopClipboardObservationGate } from './desktopClipboardObservationGate'

// Desktop never receives a Server bearer. The selected authenticated Agent
// owns each narrow operation; automatic OS polling is strictly opt-in and page-bound.
export function createDesktopClipboardDataPort(
  agent: Pick<Window['xdriveDesktop']['agent'],
    'cloudClipboardList' |
    'cloudClipboardCreate' | 'cloudClipboardDelete' | 'cloudClipboardClear' |
    'cloudClipboardDevices' | 'cloudClipboardEnableDevice' |
    'cloudClipboardRevokeDevice' | 'cloudRoot' | 'cloudChildrenPage' | 'cloudUploadFile' |
    'cloudClipboardNextEvent'>,
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
  const project = (node: AgentCloudNode, parentID?: number) => {
    if (!Number.isSafeInteger(node.id) || node.id <= 0 ||
        !['dir', 'file'].includes(node.type) ||
        !Number.isFinite(node.size) || node.size < 0 ||
        (parentID !== undefined && node.parent_id !== parentID)) {
      throw new Error('无效的当前 Owner 云端文件身份')
    }
    return { id: node.id, name: node.name, type: node.type, size: node.size }
  }
  const uploadLocalFile = async (file: File, signal: AbortSignal) => {
    verify(signal)
    if (!file || !file.name.trim() || !Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error('请选择有效的本机文件')
    const root = await run(() => agent.cloudRoot(), signal)
    if (root.type !== 'dir') throw new Error('云端文件根目录不可用')
    const uploaded = await run(() => agent.cloudUploadFile(root.id, file, 'fail'), signal)
    if (uploaded.skipped || uploaded.node.type !== 'file' ||
        uploaded.node.parent_id !== root.id || uploaded.node.revision <= 0 ||
        uploaded.node.name !== file.name || uploaded.node.size !== file.size) {
      throw new Error('文件上传回执不完整，请在 Files 中核对后再发送')
    }
    return { node_id: project(uploaded.node, root.id).id }
  }
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
    create: async (value, signal) => {
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
    browseFiles: {
      root: async signal => {
        const root = await run(() => agent.cloudRoot(), signal)
        if (root.type !== 'dir') throw new Error('当前 Owner 云端文件根目录不可用')
        return project(root)
      },
      page: async (folderID, cursor, signal) => {
        if (!Number.isSafeInteger(folderID) || folderID <= 0 ||
            (cursor !== undefined && (cursor.length > 1024 || /[\u0000\r\n]/.test(cursor)))) {
          throw new Error('无效的当前 Owner 文件目录')
        }
        const page = await run(() => agent.cloudChildrenPage(
          folderID, { limit: 50, cursor, sort: 'name', order: 'asc' }), signal)
        if (!Array.isArray(page.items) || page.items.length > 50) {
          throw new Error('无效的云端文件分页回执')
        }
        const items = page.items.map(node => project(node, folderID))
        if (new Set(items.map(item => item.id)).size !== items.length) {
          throw new Error('重复的云端文件节点')
        }
        return { items, next_cursor: page.next_cursor }
      },
    },
    uploadLocalFile,
    importImageFromClipboard: async signal => {
      verify(signal)
      if (!window.isSecureContext || typeof navigator.clipboard?.read !== 'function') {
        throw new Error('Desktop 当前环境不允许用户主动读取剪贴板图片')
      }
      // The browser permission read starts in the actual button click.
      const reading = navigator.clipboard.read()
      const items = await reading
      verify(signal)
      const formats = [
        ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
        ['image/gif', 'gif'], ['image/avif', 'avif'],
        ['image/heic', 'heic'], ['image/heif', 'heif'],
      ] as const
      const match = formats.flatMap(([mime, ext]) =>
        items.filter(item => item.types.includes(mime)).map(item => ({ mime, ext, item })))[0]
      if (!match) throw new Error('剪贴板没有可读取的图片')
      const blob = await match.item.getType(match.mime)
      verify(signal)
      if (!Number.isSafeInteger(blob.size) || blob.size <= 0)
        throw new Error('无效的本机剪贴板图片')
      return uploadLocalFile(new File(
        [blob], 'Clipboard-' + crypto.randomUUID() + '.' + match.ext,
        { type: match.mime, lastModified: Date.now() }), signal)
    },
    // The canonical Server SSE is read only by the authenticated Agent.
    // The Host sees an invalidation cursor, never a Server token or content.
    watchChanges: async (onChange, signal) => {
      let cursor = 0
      let previous: string | undefined
      let failedAt = 0
      let wasHidden = false
      const delay = (ms: number) => new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return }
        const onAbort = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
      })
      while (!signal.aborted) {
        verify(signal)
        if (document.visibilityState !== 'visible') {
          wasHidden = true
          previous = undefined
          await delay(1000)
          continue
        }
        if (wasHidden) { wasHidden = false; onChange() }
        if (failedAt === 0 || Date.now() - failedAt >= 15000) {
          try {
            const event = await run(() => agent.cloudClipboardNextEvent(cursor), signal)
            if (!Number.isSafeInteger(event.cursor) || event.cursor < cursor ||
                (event.changed && event.cursor <= cursor)) {
              throw new Error('无效的 Clipboard 云端事件')
            }
            cursor = event.cursor
            failedAt = 0
            previous = undefined
            verify(signal)
            if (event.changed && document.visibilityState === 'visible') onChange()
            continue
          } catch (error) {
            verify(signal)
            // An older offline Agent still gets the unchanged 15s GET page
            // fallback; 1.8s foreground polling is temporary, never SSE.
            failedAt = Date.now()
          }
        }
        const page = await run(() => agent.cloudClipboardList(0), signal)
        const version = page.items.map(item => item.id + ':' + item.client_event_id).join('|')
        if (previous !== undefined && previous !== version &&
            document.visibilityState === 'visible') onChange()
        previous = version
        await delay(1800)
      }
    },
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
