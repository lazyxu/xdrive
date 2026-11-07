import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import {
  xDriveClipboardDeriveKey, xDriveClipboardEncrypt, xDriveClipboardDecrypt,
  xDriveClipboardValidateText, xDriveClipboardMakeVaultCheck,
  xDriveClipboardVerifyVaultCheck, xDriveClipboardKind, type XDriveClipboardKind,
} from '../clipboard-crypto'
import { XDriveClipboardActionFence } from '../clipboard-action-fence'
import { xDriveClipboardEncryptForDevice, type XDriveClipboardTargetWire } from '../clipboard-target-crypto'

export type XDriveClipboardItem = {
  id: number
  client_event_id: string
  kind: XDriveClipboardKind
  nonce: string
  ciphertext: string
  created_at: string
  expires_at: string
  target_device_id?: string
  ephemeral_key?: string
  wrapped_key?: string
  node_id?: number
}

export type XDriveClipboardTargetDevice = {
  device_id: string
  name: string
  platform: string
  public_key: string
}

export type XDriveClipboardDataPort = {
  /** Server origin + authenticated, verified Owner ID. Never contain a token. */
  readonly ownerScopeKey: string
  vault(signal?: AbortSignal): Promise<{ salt: string; iterations: number; kdf: string;
    check_nonce: string; check_ciphertext: string; aad_scope: string; owner_id?: number }>
  initializeCheck(check: { nonce: string; ciphertext: string; scope: string }, signal?: AbortSignal): Promise<{
    salt: string; iterations: number; kdf: string; check_nonce: string; check_ciphertext: string; aad_scope: string }>
  list(before?: number, signal?: AbortSignal): Promise<{ items: XDriveClipboardItem[]; next_before: number | null }>
  create(item: {
    client_event_id: string; kind: XDriveClipboardTargetWire['kind']
    nonce: string; ciphertext: string
    target_device_id?: string; ephemeral_key?: string; wrapped_key?: string
    node_id?: number
  }, signal?: AbortSignal): Promise<XDriveClipboardItem>
  remove(id: number, signal?: AbortSignal): Promise<void>
  clear(signal?: AbortSignal): Promise<void>
  /** Must be initiated by the user's gesture; never silently query OS clipboard. */
  readText?(): Promise<string>
  copyText(text: string): Promise<void>
  /** Canonical v1 AES AAD scope for native hosts, derived from verified Owner ID. */
  claimScope?(vault: { owner_id?: number }): string
  /** Optional authenticated SSE. The existing foreground refresh remains a fallback. */
  watchChanges?(onChange: () => void, signal: AbortSignal): Promise<void>
  /** Desktop-only, opt-in, unlocked and visible monitoring; callback does not read Web clipboard. */
  watchLocalClipboard?(onChange: (text: string) => Promise<void>, signal: AbortSignal): Promise<void>
  /** Owner session only; public X25519 keys, no source/backup grants. */
  listDevices?(signal?: AbortSignal): Promise<{ devices: XDriveClipboardTargetDevice[] }>
  revokeDevice?(deviceID: string, signal?: AbortSignal): Promise<void>
}

type DecodedItem = { record: XDriveClipboardItem; text: string | null }

// Unknown ACKs are only briefly retryable. After history expiry/eviction,
// replaying the same EventID is not reliably idempotent.
const CLIPBOARD_PENDING_RETRY_WINDOW_MS = 5 * 60 * 1000

function errorLabel(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '剪贴板操作失败，请重试。'
}

/** A separate Owner-bound component prevents old key/history surviving A→B→A. */
export function XDriveClipboardPage({ port }: { port: XDriveClipboardDataPort }) {
  return <XDriveClipboardOwnerPage key={port.ownerScopeKey} port={port} />
}

function XDriveClipboardOwnerPage({ port }: { port: XDriveClipboardDataPort }) {
  const [passphrase, setPassphrase] = useState('')
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [aadScope, setAADScope] = useState<string | null>(null)
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
  const [referenceKind, setReferenceKind] = useState<'text' | 'image' | 'file'>('text')
  const [nodeID, setNodeID] = useState('')
  const active = useRef(true)
  const actionFence = useRef(new XDriveClipboardActionFence())
  const generation = useRef(0)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  // A failed/unknown ACK retry must use the *same* encrypted EventID/bytes.
  const pending = useRef<{
    text: string
    createdAt: number
    targetID: string
    nodeID: number
    item: { client_event_id: string; kind: XDriveClipboardKind | XDriveClipboardTargetWire['kind']; nonce: string; ciphertext: string;
      target_device_id?: string; ephemeral_key?: string; wrapped_key?: string; node_id?: number }
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
    if (!key || !aadScope) return
    const sequence = ++generation.current
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    setLoading(true)
    try {
      const page = await port.list(before, controller.signal)
      const decoded = await Promise.all(page.items.map(async record => {
        try {
          return { record, text: await xDriveClipboardDecrypt(key, aadScope, record) }
        } catch {
          return { record, text: null }
        }
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
  }, [key, aadScope, port])

  useEffect(() => {
    if (!key) return
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
  }, [key, load])

  useEffect(() => {
    if (!key || !port.watchChanges) return
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
  }, [key, port, load])

  useEffect(() => {
    if (!key || !port.listDevices) { setTargetDevices([]); setTargetID(''); return }
    const controller = new AbortController()
    void port.listDevices(controller.signal).then(result => {
      if (!controller.signal.aborted && active.current)
        setTargetDevices(result.devices.filter(d =>
          !!d.device_id && /^[A-Za-z0-9+/]{43}=$/.test(d.public_key)))
    }).catch(() => {
      if (!controller.signal.aborted && active.current) {
        setTargetDevices([])
        setTargetID('')
      }
    })
    return () => controller.abort()
  }, [key, port])

  const unlock = async () => {
    if (busy || key) return
    const actionToken = actionFence.current.capture()
    setMessage('')
    setBusy(true)
    const controller = new AbortController()
    writeController.current = controller
    try {
      const info = await port.vault(controller.signal)
      if (info.kdf !== 'PBKDF2-SHA256' || info.iterations !== 310000) {
        throw new Error('Server 剪贴板加密版本不兼容。')
      }
      const nextKey = await xDriveClipboardDeriveKey(passphrase, info.salt)
      const claimScope = port.claimScope ? port.claimScope(info) : port.ownerScopeKey
      const verified = info.check_ciphertext
        ? info
        : await port.initializeCheck({
            ...await xDriveClipboardMakeVaultCheck(nextKey, claimScope),
            scope: claimScope,
          }, controller.signal)
      let canonicalScope = verified.aad_scope || claimScope
      await xDriveClipboardVerifyVaultCheck(nextKey, canonicalScope, {
        nonce: verified.check_nonce, ciphertext: verified.check_ciphertext,
      })
      // Legacy canaries have no AAD scope. Pin it only after successful
      // local verification; keep the original ciphertext and passphrase.
      if (!verified.aad_scope) {
        const pinned = await port.initializeCheck({
          nonce: verified.check_nonce, ciphertext: verified.check_ciphertext,
          scope: claimScope,
        }, controller.signal)
        // During a rolling Server/Web deployment an older Server may omit
        // aad_scope. The successfully verified original-origin v1 vault
        // remains usable; cross-domain support becomes available after
        // the Server is upgraded and the original browser pins its scope.
        canonicalScope = pinned.aad_scope || claimScope
        await xDriveClipboardVerifyVaultCheck(nextKey, canonicalScope, {
          nonce: pinned.check_nonce, ciphertext: pinned.check_ciphertext,
        })
      }
      if (!active.current || controller.signal.aborted) return
      setAADScope(canonicalScope)
      setKey(nextKey)
      setPassphrase('')
    } catch (error) {
      if (active.current && !controller.signal.aborted) setMessage(errorLabel(error))
    } finally {
      if (active.current && actionFence.current.isCurrent(actionToken)) setBusy(false)
    }
  }

  const send = async (observedText?: string) => {
    if (!key || !aadScope || busy || (observedText !== undefined && pending.current)) return
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
    if (pending.current) {
      // An unknown server ACK is not proof of failure. Editing or pasting a
      // different draft must not silently discard the original retry receipt.
      if (pending.current.text !== textAtStart || pending.current.targetID !== selectedTarget ||
          pending.current.nodeID !== selectedNodeID) {
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
          pending.current?.nodeID !== selectedNodeID) {
        const client_event_id = crypto.randomUUID()
        const encrypted = selectedDevice
          ? await xDriveClipboardEncryptForDevice(aadScope, selectedTarget, selectedDevice.public_key,
              client_event_id, isRef
                ? (referenceKind === 'image' ? 'image/x-xdrive-node-ref' : 'application/x-xdrive-node-ref')
                : xDriveClipboardKind(textAtStart), textAtStart, selectedNodeID)
          : await xDriveClipboardEncrypt(key, aadScope, client_event_id, textAtStart)
        // AES-GCM is not abortable: Lock can happen while encryption is pending.
        // Do not resurrect the previous Owner/session's retry cache.
        if (!active.current || controller.signal.aborted ||
            !actionFence.current.isCurrent(actionToken)) return
        pending.current = { text: textAtStart, targetID: selectedTarget, nodeID: selectedNodeID,
          createdAt: Date.now(), item: { client_event_id, ...encrypted } }
      }
      if (!active.current || controller.signal.aborted ||
          !actionFence.current.isCurrent(actionToken)) return
      await port.create(pending.current.item, controller.signal)
      if (!active.current || controller.signal.aborted ||
          !actionFence.current.isCurrent(actionToken)) return
      pending.current = null
      setDraft(current => observedText === undefined && !isRef && current === textAtStart ? '' : current)
      setMessage(observedText !== undefined
        ? '已自动加密发送剪贴板变化。'
        : selectedTarget ? '已加密投递至所选设备；只有目标设备可解密。'
          : '已加密发送至当前账号的剪贴板历史。')
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
    if (!monitorEnabled || !key || !aadScope || !port.watchLocalClipboard) return
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
  }, [monitorEnabled, key, aadScope, port, busy, draft])

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

  const lock = () => {
    // A Browser clipboard permission prompt may finish after Lock. Never
    // reintroduce its plaintext or a stale success/failure into this vault.
    actionFence.current.invalidate()
    writeController.current?.abort()
    readController.current?.abort()
    generation.current++
    pending.current = null
    setKey(null)
    setAADScope(null)
    setItems([])
    setNextBefore(null)
    setDraft('')
    setPassphrase('')
    setReading(false)
    setBusy(false)
    setConfirmClear(false)
    setRetryExpired(false)
    setTargetDevices([])
    setTargetID('')
    setConfirmRevoke(false)
    setReferenceKind('text')
    setNodeID('')
    setMonitorEnabled(false)
    setMessage('剪贴板已锁定，本地明文和密钥已从页面状态清除。')
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 900, mx: 'auto', pb: 5 }} data-xdrive-clipboard>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>剪贴板</Typography>
          <Typography variant="body2" color="text.secondary">
            当前账号的端到端加密文本收件箱 · 手动复制与发送
          </Typography>
        </Box>
        {key ? <Button color="inherit" onClick={lock}>锁定</Button> : null}
      </Stack>
      <Alert severity="info">
        Web/PWA 不会监听系统剪贴板。Desktop 监听默认关闭；仅在解锁且此页面可见时，可明确开启自动加密发送。
        使用 HTTPS/localhost；不同浏览器需输入相同的独立剪贴板口令。
        忘记口令后旧消息无法解密。
      </Alert>
      {message ? <Alert severity={message.startsWith('已') ? 'success' : 'warning'} onClose={() => setMessage('')}>{message}</Alert> : null}
      {!key ? (
        <Card variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography variant="h6">解锁加密剪贴板</Typography>
            <Typography variant="body2" color="text.secondary">
              首次使用请输入新的独立口令（至少 12 个字符）。
              以后在其他浏览器中使用相同口令。Server 不会保存口令。
            </Typography>
            <TextField type="password" label="剪贴板口令" autoComplete="new-password"
              value={passphrase} onChange={event => setPassphrase(event.target.value)}
              inputProps={{ maxLength: 256 }} fullWidth />
            <Button variant="contained" disabled={busy || passphrase.length < 12}
              onClick={() => { void unlock() }}>解锁</Button>
          </Stack>
        </Card>
      ) : (
        <>
          <Card variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography variant="h6">发送文字或链接</Typography>
              <TextField label="输入内容" multiline minRows={3} maxRows={10} fullWidth
                value={draft} onChange={event => { setDraft(event.target.value); setRetryExpired(false) }}
                helperText="最多 64 KiB；不会在浏览器本地持久保存。" />
              {port.listDevices ? (
                <Stack spacing={1}>
                  <TextField select label="发送范围" value={targetID}
                    onChange={e => { setTargetID(e.target.value); setConfirmRevoke(false) }} size="small">
                    <MenuItem value="">当前 Owner 所有已解锁客户端（广播）</MenuItem>
                    {targetDevices.map(device => (
                      <MenuItem key={device.device_id} value={device.device_id}>
                        {device.name} · {device.platform}
                      </MenuItem>
                    ))}
                  </TextField>
                  {targetID ? (
                    <>
                      <TextField select label="内容类型" value={referenceKind} size="small"
                        onChange={e => setReferenceKind(e.target.value as 'text' | 'image' | 'file')}>
                        <MenuItem value="text">文本或链接</MenuItem>
                        <MenuItem value="image">现有云端图片引用</MenuItem>
                        <MenuItem value="file">现有云端文件引用</MenuItem>
                      </TextField>
                      {referenceKind !== 'text' ? <TextField label="已上传的云端文件 ID"
                        size="small" inputProps={{ inputMode: 'numeric' }}
                        value={nodeID} onChange={e => setNodeID(e.target.value)}
                        helperText="引用现有 CAS/UploadSession 完成的文件；不会重新上传或复制原件。" /> : null}
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
                  {busy ? '处理中…' : '加密发送'}
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
            }>确定删除当前账号全部剪贴板密文历史吗？此操作不可撤销。</Alert>
          ) : null}
          {!items.length && !loading ? (
            <Typography color="text.secondary">暂无有效消息。可从同一账号的其他浏览器发送文字。</Typography>
          ) : null}
          {items.map(({ record, text }) => (
            <Card key={record.id} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary">
                    {record.kind === 'text/uri-list' ? '链接' : '文本'} · {new Date(record.created_at).toLocaleString()}
                  </Typography>
                  <Button size="small" color="error" disabled={busy}
                    onClick={() => { void runAction(signal => port.remove(record.id, signal), '已删除消息。') }}>
                    删除
                  </Button>
                </Stack>
                {text === null ? (
                  <Alert severity="error">无法解密。请检查口令是否与发送端一致，或消息是否损坏。</Alert>
                ) : (
                  <>
                    <TextField fullWidth multiline minRows={1} maxRows={7} value={text}
                      InputProps={{ readOnly: true }} aria-label="剪贴板明文（仅在此页面内解密）" />
                    <Stack direction="row" justifyContent="flex-end">
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
            最多保留 50 条未过期消息，24 小时后自动不可见。当前版本没有设备定向发送或后台自动监控。
          </Typography>
        </>
      )}
    </Stack>
  )
}
