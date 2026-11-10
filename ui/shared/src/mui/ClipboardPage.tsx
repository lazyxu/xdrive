import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'

import { XDriveClipboardActionFence } from '../clipboard-action-fence'

import { ClipboardFileNodePicker, type ClipboardFileBrowsePort } from './ClipboardFileNodePicker'

export type XDriveClipboardKind = 'text/plain' | 'text/uri-list' |
  'image/x-xdrive-node-ref' | 'application/x-xdrive-node-ref'

export type XDriveClipboardItem = {
  id: number
  client_event_id: string
  kind: XDriveClipboardKind
  content: string
  created_at: string
  expires_at: string
  target_device_id?: string
  node_id?: number
}

export type XDriveClipboardTargetDevice = {
  device_id: string
  name: string
  platform: string
}

export type XDriveClipboardDataPort = {
  readonly ownerScopeKey: string
  list(before?: number, signal?: AbortSignal): Promise<{ items: XDriveClipboardItem[]; next_before: number | null }>
  create(item: { client_event_id: string; kind: XDriveClipboardKind; content: string;
    target_device_id?: string; node_id?: number }, signal?: AbortSignal): Promise<XDriveClipboardItem>
  remove(id: number, signal?: AbortSignal): Promise<void>
  clear(signal?: AbortSignal): Promise<void>
  readText?(): Promise<string>
  copyText(text: string): Promise<void>
  watchChanges?(onChange: () => void, signal: AbortSignal): Promise<void>
  watchLocalClipboard?(onChange: (text: string) => Promise<void>, signal: AbortSignal): Promise<void>
  listDevices?(signal?: AbortSignal): Promise<{ devices: XDriveClipboardTargetDevice[] }>
  revokeDevice?(deviceID: string, signal?: AbortSignal): Promise<void>
  enableDeviceRecipient?(signal?: AbortSignal): Promise<XDriveClipboardTargetDevice>
  browseFiles?: ClipboardFileBrowsePort
  uploadLocalFile?(file: File, signal: AbortSignal): Promise<{ node_id: number }>
  importImageFromClipboard?(signal: AbortSignal): Promise<{ node_id: number }>
  openReferencedFile?(nodeID: number, signal: AbortSignal): Promise<void>
}

function xDriveClipboardKind(text: string): XDriveClipboardKind {
  return /^https?:\/\/\S+$/i.test(text.trim()) ? 'text/uri-list' : 'text/plain'
}

function xDriveClipboardValidateText(text: string): void {
  const size = new TextEncoder().encode(text).length
  if (!size || size > 65536) throw new Error('剪贴板只支持 1–65536 字节的文本。')
}

type DecodedItem = { record: XDriveClipboardItem; text: string | null }

// Unknown ACKs are only briefly retryable. After history expiry/eviction,
// replaying the same EventID is not reliably idempotent.
const CLIPBOARD_PENDING_RETRY_WINDOW_MS = 5 * 60 * 1000

function errorLabel(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '剪贴板操作失败，请重试。'
}

/** Separate Owner-bound state prevents stale history surviving A→B→A. */
export function XDriveClipboardPage({ port }: { port: XDriveClipboardDataPort }) {
  return <XDriveClipboardOwnerPage key={port.ownerScopeKey} port={port} />
}

function XDriveClipboardOwnerPage({ port }: { port: XDriveClipboardDataPort }) {
  const [draft, setDraft] = useState('')
  const [items, setItems] = useState<DecodedItem[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [retryExpired, setRetryExpired] = useState(false)
  const [monitorEnabled, setMonitorEnabled] = useState(false)
  const [targetDevices, setTargetDevices] = useState<XDriveClipboardTargetDevice[]>([])
  const [targetID, setTargetID] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [referenceKind, setReferenceKind] = useState<'text' | 'image' | 'file'>('text')
  const [nodeID, setNodeID] = useState('')
  const localUploadInput = useRef<HTMLInputElement | null>(null)
  const active = useRef(true)
  const actionFence = useRef(new XDriveClipboardActionFence())
  const generation = useRef(0)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  // A failed/unknown ACK retry must use the same EventID/content/target.
  const pending = useRef<{
    text: string
    createdAt: number
    targetID: string
    nodeID: number
    item: { client_event_id: string; kind: XDriveClipboardKind; content: string;
      target_device_id?: string; node_id?: number }
  } | null>(null)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      actionFence.current.invalidate()
      generation.current++
      readController.current?.abort()
      writeController.current?.abort()
      pending.current = null
    }
  }, [])

  const load = useCallback(async (before?: number) => {
    const sequence = ++generation.current
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    setLoading(true)
    try {
      const page = await port.list(before, controller.signal)
      // The message is already plaintext; a Node reference still must match
      // its immutable, Server-validated identity before opening Files Viewer.
      const decoded: DecodedItem[] = page.items.map(record => ({
        record,
        text: typeof record.content !== 'string' ||
          (record.node_id && record.content !== 'asset:' + record.node_id)
          ? null : record.content,
      }))
      if (!active.current || controller.signal.aborted || sequence !== generation.current) return
      setItems(previous => before
        ? [...previous, ...decoded.filter(row => !previous.some(existing => existing.record.id === row.record.id))]
        : decoded)
      setNextBefore(page.next_before)
    } catch (error) {
      if (active.current && !controller.signal.aborted && sequence === generation.current)
        setMessage(errorLabel(error))
    } finally {
      if (active.current && sequence === generation.current) setLoading(false)
    }
  }, [port])

  useEffect(() => {
    void load()
    // Only the *visible* mounted page polls. There is no background read of
    // the browser clipboard, no hidden PWA task, and no Server SSE claim.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => {
      window.clearInterval(timer)
      generation.current++
      readController.current?.abort()
    }
  }, [load])

  useEffect(() => {
    if (!port.watchChanges) return
    const controller = new AbortController()
    // SSE carries only invalidation signals. GET /items remains authoritative.
    // Reconnect is bounded; old deployments keep using foreground polling.
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      if (controller.signal.aborted) return
      try {
        await port.watchChanges!(() => {
          if (!controller.signal.aborted && document.visibilityState === 'visible') void load()
        }, controller.signal)
      } catch {
        // Failed/unsupported SSE never disables the existing visible refresh.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void run() }, 3000)
      }
    }
    void run()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [port, load])

  useEffect(() => {
    if (!port.listDevices) { setTargetDevices([]); setTargetID(''); return }
    const controller = new AbortController()
    void port.listDevices(controller.signal).then(result => {
      if (!controller.signal.aborted && active.current)
        setTargetDevices(result.devices.filter(d => !!d.device_id))
    }).catch(() => {
      if (!controller.signal.aborted && active.current) {
        setTargetDevices([])
        setTargetID('')
      }
    })
    return () => controller.abort()
  }, [port])

  const send = async (observedText?: string) => {
    if (busy || (observedText !== undefined && pending.current)) return
    const isRef = observedText === undefined && referenceKind !== 'text'
    const selectedNodeID = isRef ? Number(nodeID) : 0
    const selectedTarget = observedText === undefined ? targetID : ''
    const selectedDevice = targetDevices.find(device => device.device_id === selectedTarget)
    if (isRef && (!Number.isSafeInteger(selectedNodeID) || selectedNodeID <= 0 || !selectedDevice)) {
      setMessage('发送云端图片或文件引用，需要有效的现有文件 ID 与已登记的目标设备。')
      return
    }
    if (selectedTarget && !selectedDevice) { setMessage('所选设备已失效，请刷新并重新选择。'); return }
    const textAtStart = isRef ? 'asset:' + selectedNodeID : observedText ?? draft
    const actionToken = actionFence.current.capture()
    setMessage('')
    try { xDriveClipboardValidateText(textAtStart) } catch (error) {
      setMessage(errorLabel(error)); return
    }
    // Exact kind is authenticated AEAD metadata, not a display-only label.
    // An unknown ACK for an image reference must not be reused as a file
    // reference to the same Node/recipient (or vice versa).
    const expectedKind: XDriveClipboardKind = isRef
      ? (referenceKind === 'image' ? 'image/x-xdrive-node-ref' : 'application/x-xdrive-node-ref')
      : xDriveClipboardKind(textAtStart)
    if (pending.current) {
      // An unknown server ACK is not proof of failure. Editing or pasting a
      // different draft must not silently discard the original retry receipt.
      if (pending.current.text !== textAtStart || pending.current.targetID !== selectedTarget ||
          pending.current.nodeID !== selectedNodeID || pending.current.item.kind !== expectedKind) {
        setRetryExpired(true)
        setMessage('上一条发送回执仍未确认。请先核对历史，或明确放弃旧回执后再发送新内容。')
        return
      }
      const age = Date.now() - pending.current.createdAt
      if (!Number.isFinite(age) || age < 0 || age >= CLIPBOARD_PENDING_RETRY_WINDOW_MS) {
        setRetryExpired(true)
        setMessage('待确认回执已超过安全重试期限。请先核对历史，或明确放弃旧回执再重新发送。')
        return
      }
    }
    setRetryExpired(false)
    setBusy(true)
    const controller = new AbortController()
    writeController.current = controller
    try {
      if (pending.current?.text !== textAtStart || pending.current?.targetID !== selectedTarget ||
          pending.current?.nodeID !== selectedNodeID || pending.current?.item.kind !== expectedKind) {
        const client_event_id = crypto.randomUUID()
        const item = { client_event_id, kind: expectedKind, content: textAtStart,
          ...(selectedTarget ? { target_device_id: selectedTarget } : {}),
          ...(selectedNodeID > 0 ? { node_id: selectedNodeID } : {}) }
        // A route teardown or Owner change must never resurrect stale receipts.
        if (!active.current || controller.signal.aborted ||
            !actionFence.current.isCurrent(actionToken)) return
        pending.current = { text: textAtStart, targetID: selectedTarget, nodeID: selectedNodeID,
          createdAt: Date.now(), item }
      }
      if (!active.current || controller.signal.aborted ||
          !actionFence.current.isCurrent(actionToken)) return
      await port.create(pending.current.item, controller.signal)
      if (!active.current || controller.signal.aborted ||
          !actionFence.current.isCurrent(actionToken)) return
      pending.current = null
      setDraft(current => observedText === undefined && !isRef && current === textAtStart ? '' : current)
      setMessage(observedText !== undefined
        ? '已自动同步剪贴板变化。'
        : selectedTarget ? '已发送至所选设备。'
          : '已发送至当前账号的剪贴板历史。')
      void load()
    } catch (error) {
      if (active.current && !controller.signal.aborted &&
          actionFence.current.isCurrent(actionToken))
        setMessage('发送未确认；原消息 ID 保留供重试。' + errorLabel(error))
    } finally {
      if (active.current && actionFence.current.isCurrent(actionToken)) setBusy(false)
    }
  }

  useEffect(() => {
    if (!monitorEnabled || !port.watchLocalClipboard) return
    const controller = new AbortController()
    let alive = true
    void port.watchLocalClipboard(async text => {
      // Do not overwrite a manually edited draft, an uncertain receipt, or
      // another in-flight action. The watcher never retries unknown ACKs.
      if (!alive || controller.signal.aborted || !active.current ||
          busy || draft.length > 0 || pending.current || document.visibilityState !== 'visible') return
      await send(text)
    }, controller.signal).catch(error => {
      if (alive && active.current && !controller.signal.aborted) {
        setMonitorEnabled(false)
        setMessage('系统剪贴板监控已停止：' + errorLabel(error))
      }
    })
    return () => { alive = false; controller.abort() }
  // React state changes re-arm the observer with a new local baseline.
  }, [monitorEnabled, port, busy, draft])

  const runAction = async (action: (signal: AbortSignal) => Promise<void>, success: string) => {
    if (busy) return
    const actionToken = actionFence.current.capture()
    setBusy(true)
    setMessage('')
    const controller = new AbortController()
    writeController.current = controller
    try {
      await action(controller.signal)
      if (!active.current || controller.signal.aborted) return
      setMessage(success)
      await load()
    } catch (error) {
      if (active.current && !controller.signal.aborted) setMessage(errorLabel(error))
    } finally {
      if (active.current && actionFence.current.isCurrent(actionToken)) setBusy(false)
    }
  }

  const importToOwnerFiles = async (
    upload: (signal: AbortSignal) => Promise<{ node_id: number }>,
  ) => {
    if (busy || !targetID || referenceKind === 'text') return
    if (pending.current) {
      setRetryExpired(true)
      setMessage('上一条发送回执尚未确认，请先核对并明确放弃旧回执，不会自动再次上传。')
      return
    }
    const actionToken = actionFence.current.capture()
    setNodeID('') // A failed upload must never send a previously selected Node.
    await runAction(async signal => {
      const receipt = await upload(signal)
      if (!Number.isSafeInteger(receipt.node_id) || receipt.node_id <= 0)
        throw new Error('没有收到有效的 CAS 文件节点 ID。')
      if (active.current && !signal.aborted && actionFence.current.isCurrent(actionToken)) {
        setNodeID(String(receipt.node_id))
      }
    }, '已上传到当前 Owner 的云端根目录。请检查文件，然后明确点击“发送”；不发送也不会自动删除原件。')
  }

  const openVerifiedReference = (record: XDriveClipboardItem, text: string | null) => {
    if (busy || !port.openReferencedFile || !record.target_device_id ||
        (record.kind !== 'image/x-xdrive-node-ref' &&
         record.kind !== 'application/x-xdrive-node-ref') ||
        !Number.isSafeInteger(record.node_id) || !record.node_id ||
        text !== 'asset:' + record.node_id ||
        !items.some(row => row.record.id === record.id && row.record === record &&
          row.text === text)) {
      setMessage('文件引用已失效或当前设备无权预览，请刷新后重新验证。')
      return
    }
    // The existing Files Host rechecks Owner, Node location, revision and
    // its normal read permission. Do not fetch bytes from Clipboard.
    void runAction(signal => port.openReferencedFile!(record.node_id!, signal),
      '已转到经过授权的文件 Viewer。')
  }

  const pasteFromBrowser = async () => {
    if (!port.readText || reading) return
    const actionToken = actionFence.current.capture()
    setReading(true)
    setMessage('')
    try {
      // Called synchronously from the click event. A read permission rejection
      // leaves the manual input untouched; no automatic OS-clipboard observer.
      const text = await port.readText()
      xDriveClipboardValidateText(text)
      if (active.current && actionFence.current.isCurrent(actionToken)) setDraft(text)
    } catch {
      if (active.current && actionFence.current.isCurrent(actionToken)) setMessage('浏览器未允许读取剪贴板；请直接在输入框粘贴内容。')
    } finally {
      if (active.current && actionFence.current.isCurrent(actionToken)) setReading(false)
    }
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 900, mx: 'auto', pb: 5 }} data-xdrive-clipboard>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>剪贴板</Typography>
          <Typography variant="body2" color="text.secondary">
            当前账号的剪贴板 · 文本与已上传文件引用
          </Typography>
        </Box>

      </Stack>
      <Alert severity="info">
        剪贴板内容不会端到端加密；Server 保存明文，请勿发送密码或验证码。
        Web/PWA 不自动监听系统剪贴板；Desktop 默认关闭监听，仅在明确开启且页面可见时同步。
      </Alert>
      {message ? <Alert severity={message.startsWith('已') ? 'success' : 'warning'} onClose={() => setMessage('')}>{message}</Alert> : null}
                <Card variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography variant="h6">发送文字或链接</Typography>
              <TextField label="输入内容" multiline minRows={3} maxRows={10} fullWidth
                value={draft} onChange={event => { setDraft(event.target.value); setRetryExpired(false) }}
                helperText="最多 64 KiB；不会在浏览器本地持久保存。" />
              {port.enableDeviceRecipient ? (
                <Button size="small" variant="outlined" disabled={busy}
                  onClick={() => {
                    void runAction(async signal => {
                      const device = await port.enableDeviceRecipient!(signal)
                      if (active.current && !signal.aborted) {
                        setTargetDevices(current => [...current.filter(
                          row => row.device_id !== device.device_id), device])
                      }
                    }, '此安装已启用单独授权的 Clipboard 定向接收。')
                  }}>启用此设备的定向接收（需要已登记安装）</Button>
              ) : null}
              {port.listDevices ? (
                <Stack spacing={1}>
                  <TextField select label="发送范围" value={targetID} disabled={busy}
                    onChange={e => {
                      setTargetID(e.target.value)
                      setConfirmRevoke(false)
                      setPickerOpen(false)
                      // Switching recipient/broadcast invalidates the previous
                      // Node intent; never silently send it to another device.
                      setReferenceKind('text')
                      setNodeID('')
                    }} size="small">
                    <MenuItem value="">当前账号全部客户端（广播）</MenuItem>
                    {targetDevices.map(device => (
                      <MenuItem key={device.device_id} value={device.device_id}>
                        {device.name} · {device.platform}
                      </MenuItem>
                    ))}
                  </TextField>
                  {targetID ? (
                    <>
                      <TextField select label="内容类型" value={referenceKind} size="small" disabled={busy}
                        onChange={e => {
                          // A Node chosen for an image must never silently become
                          // a file (or vice versa) without a fresh user choice.
                          setReferenceKind(e.target.value as 'text' | 'image' | 'file')
                          setNodeID('')
                        }}>
                        <MenuItem value="text">文本或链接</MenuItem>
                        <MenuItem value="image">现有云端图片引用</MenuItem>
                        <MenuItem value="file">现有云端文件引用</MenuItem>
                      </TextField>
                      {referenceKind !== 'text' ? (
                        <>
                          <TextField label="已上传的云端文件 ID"
                            size="small" inputProps={{ inputMode: 'numeric', readOnly: !!port.browseFiles }}
                            value={nodeID} onChange={e => setNodeID(e.target.value)}
                            helperText="引用现有 CAS/UploadSession 完成的文件；不会重新上传或复制原件。" />
                          {port.browseFiles ? (
                            <>
                              <Button size="small" variant="outlined" disabled={busy}
                                onClick={() => setPickerOpen(true)}>从云端文件选择</Button>
                              <ClipboardFileNodePicker
                                open={pickerOpen && !!targetID}
                                port={port.browseFiles} kind={referenceKind}
                                onClose={() => setPickerOpen(false)}
                                onSelect={item => {
                                  setNodeID(String(item.id))
                                  setPickerOpen(false)
                                }}
                              />
                            </>
                          ) : null}
                          {(port.uploadLocalFile || port.importImageFromClipboard) ? (
                            <>
                              {port.uploadLocalFile ? (
                                <>
                                  <input ref={localUploadInput} type="file" hidden
                                    accept={referenceKind === 'image' ? 'image/*' : undefined}
                                    onChange={event => {
                                      const file = event.currentTarget.files?.[0]
                                      event.currentTarget.value = ''
                                      if (file) void importToOwnerFiles(signal => port.uploadLocalFile!(file, signal))
                                    }} />
                                  <Button variant="outlined" size="small" disabled={busy}
                                    onClick={() => localUploadInput.current?.click()}>
                                    选择本机文件并上传到云端
                                  </Button>
                                </>
                              ) : null}
                              {referenceKind === 'image' && port.importImageFromClipboard ? (
                                <Button variant="outlined" size="small" disabled={busy}
                                  onClick={() => {
                                    void importToOwnerFiles(signal => port.importImageFromClipboard!(signal))
                                  }}>读取本机剪贴板图片并上传</Button>
                              ) : null}
                              <Typography variant="caption" color="text.secondary">
                                上传通过现有 Files/CAS 写入当前 Owner 根目录；上传本身不会自动发送引用或删除原件。
                              </Typography>
                            </>
                          ) : null}
                        </>
                      ) : null}
                      {port.revokeDevice ? (
                        confirmRevoke ? (
                          <Alert severity="warning" action={
                            <Stack direction="row" spacing={1}>
                              <Button size="small" onClick={() => setConfirmRevoke(false)}>取消</Button>
                              <Button size="small" color="error" disabled={busy} onClick={() => {
                                const selected = targetID
                                setConfirmRevoke(false)
                                void runAction(async signal => {
                                  await port.revokeDevice!(selected, signal)
                                  if (active.current && !signal.aborted) {
                                    setTargetDevices(rows => rows.filter(row => row.device_id !== selected))
                                    setTargetID('')
                                  }
                                }, '已撤销所选设备的 Clipboard 接收授权。')
                              }}>确认撤权</Button>
                            </Stack>
                          }>撤权后该设备不能接收新的定向消息；已被复制的本机内容无法追回。</Alert>
                        ) : (
                          <Button variant="outlined" color="error" size="small" disabled={busy}
                            onClick={() => setConfirmRevoke(true)}>
                            撤销此设备的 Clipboard 授权
                          </Button>
                        )
                      ) : null}
                    </>
                  ) : null}
                </Stack>
              ) : null}
              {port.watchLocalClipboard ? (
                <FormControlLabel control={<Switch checked={monitorEnabled}
                    onChange={(_, checked) => setMonitorEnabled(checked)} />}
                  label="Desktop 自动同步系统剪贴板（默认关闭；可能包含密码、验证码或其他敏感文本）" />
              ) : null}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button variant="contained" disabled={busy || (referenceKind === 'text' ? !draft.length : !nodeID || !targetID)} onClick={() => { void send() }}>
                  {busy ? '处理中…' : '发送'}
                </Button>
                <Button variant="outlined" disabled={busy || reading || !port.readText}
                  onClick={() => { void pasteFromBrowser() }}>
                  从系统剪贴板读取
                </Button>
                {retryExpired && pending.current ? (
                  <Button variant="outlined" color="warning" disabled={busy} onClick={() => {
                    pending.current = null
                    setRetryExpired(false)
                    setMessage('已放弃旧回执。请先核对历史，再决定是否重新发送。')
                  }}>{pending.current.text === draft ? '放弃过期重试' : '放弃待确认回执'}</Button>
                ) : null}
              </Stack>
            </Stack>
          </Card>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">最近内容</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={loading} onClick={() => { void load() }}>刷新</Button>
              <Button size="small" color="error" disabled={busy || !items.length}
                onClick={() => setConfirmClear(true)}>清空</Button>
            </Stack>
          </Stack>
          {confirmClear ? (
            <Alert severity="warning" action={
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setConfirmClear(false)}>取消</Button>
                <Button size="small" color="error" disabled={busy}
                  onClick={() => {
                    setConfirmClear(false)
                    void runAction(signal => port.clear(signal), '已清空本账号的剪贴板历史。')
                  }}>确认清空</Button>
              </Stack>
            }>确定删除当前账号全部剪贴板历史吗？此操作不可撤销。</Alert>
          ) : null}
          {!items.length && !loading ? (
            <Typography color="text.secondary">暂无有效消息。可从同一账号的其他浏览器发送文字。</Typography>
          ) : null}
          {items.map(({ record, text }) => (
            <Card key={record.id} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary">
                    {record.kind === 'text/uri-list' ? '链接'
                      : record.kind === 'image/x-xdrive-node-ref' ? '云端图片引用'
                      : record.kind === 'application/x-xdrive-node-ref' ? '云端文件引用' : '文本'} · {new Date(record.created_at).toLocaleString()}
                  </Typography>
                  <Button size="small" color="error" disabled={busy}
                    onClick={() => { void runAction(signal => port.remove(record.id, signal), '已删除消息。') }}>
                    删除
                  </Button>
                </Stack>
                {text === null ? (
                  <Alert severity="error">消息内容无效或文件引用不匹配，请刷新。</Alert>
                ) : (
                  <>
                    <TextField fullWidth multiline minRows={1} maxRows={7} value={text}
                      InputProps={{ readOnly: true }} aria-label="剪贴板内容" />
                    <Stack direction="row" justifyContent="flex-end">
                      {port.openReferencedFile && record.target_device_id &&
                        Number.isSafeInteger(record.node_id) && !!record.node_id &&
                        (record.kind === 'image/x-xdrive-node-ref' ||
                         record.kind === 'application/x-xdrive-node-ref') &&
                        text === 'asset:' + record.node_id ? (
                          <Button size="small" variant="contained" disabled={busy}
                            onClick={() => openVerifiedReference(record, text)}>
                            在文件 Viewer 中打开
                          </Button>
                        ) : null}
                      <Button size="small" onClick={() => {
                        const actionToken = actionFence.current.capture()
                        void port.copyText(text).then(() => {
                          if (active.current && actionFence.current.isCurrent(actionToken))
                            setMessage('已复制到本机剪贴板。')
                        }).catch(error => {
                          if (active.current && actionFence.current.isCurrent(actionToken))
                            setMessage(errorLabel(error))
                        })
                      }}>复制到本机</Button>
                    </Stack>
                  </>
                )}
              </Stack>
            </Card>
          ))}
          {nextBefore ? (
            <Button disabled={loading} onClick={() => { void load(nextBefore) }}>
              {loading ? '加载中…' : '加载更早内容'}
            </Button>
          ) : null}
          <Divider />
          <Typography variant="caption" color="text.secondary">
            最多保留 50 条未过期消息，24 小时后自动不可见。
            {port.listDevices
              ? ' 此 Host 支持向已登记设备定向发送文本及现有云端文件引用。'
              : ' 此 Host 仅支持当前 Owner 的手动文本与链接发送。'}
            {port.watchLocalClipboard
              ? ' Desktop 系统剪贴板监听默认关闭，只有明确开启后才在页面可见时运行。'
              : ' 不会在后台自动读取系统剪贴板。'}
          </Typography>
    </Stack>
  )
}
