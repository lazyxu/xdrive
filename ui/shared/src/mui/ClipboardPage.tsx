import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, Divider, Stack, TextField, Typography } from '@mui/material'
import {
  xDriveClipboardDeriveKey, xDriveClipboardEncrypt, xDriveClipboardDecrypt,
  xDriveClipboardValidateText, xDriveClipboardMakeVaultCheck,
  xDriveClipboardVerifyVaultCheck, type XDriveClipboardKind,
} from '../clipboard-crypto'

export type XDriveClipboardItem = {
  id: number
  client_event_id: string
  kind: XDriveClipboardKind
  nonce: string
  ciphertext: string
  created_at: string
  expires_at: string
}

export type XDriveClipboardDataPort = {
  /** Server origin + authenticated, verified Owner ID. Never contain a token. */
  readonly ownerScopeKey: string
  vault(signal?: AbortSignal): Promise<{ salt: string; iterations: number; kdf: string;
    check_nonce: string; check_ciphertext: string; aad_scope: string }>
  initializeCheck(check: { nonce: string; ciphertext: string; scope: string }, signal?: AbortSignal): Promise<{
    salt: string; iterations: number; kdf: string; check_nonce: string; check_ciphertext: string; aad_scope: string }>
  list(before?: number, signal?: AbortSignal): Promise<{ items: XDriveClipboardItem[]; next_before: number | null }>
  create(item: {
    client_event_id: string; kind: XDriveClipboardKind
    nonce: string; ciphertext: string
  }, signal?: AbortSignal): Promise<XDriveClipboardItem>
  remove(id: number, signal?: AbortSignal): Promise<void>
  clear(signal?: AbortSignal): Promise<void>
  /** Must be initiated by the user's gesture; never silently query OS clipboard. */
  readText?(): Promise<string>
  copyText(text: string): Promise<void>
}

type DecodedItem = { record: XDriveClipboardItem; text: string | null }

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
  const active = useRef(true)
  const generation = useRef(0)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  // A failed/unknown ACK retry must use the *same* encrypted EventID/bytes.
  const pending = useRef<{
    text: string
    item: { client_event_id: string; kind: XDriveClipboardKind; nonce: string; ciphertext: string }
  } | null>(null)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
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

  const unlock = async () => {
    if (busy || key) return
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
      const verified = info.check_ciphertext
        ? info
        : await port.initializeCheck({
            ...await xDriveClipboardMakeVaultCheck(nextKey, port.ownerScopeKey),
            scope: port.ownerScopeKey,
          }, controller.signal)
      let canonicalScope = verified.aad_scope || port.ownerScopeKey
      await xDriveClipboardVerifyVaultCheck(nextKey, canonicalScope, {
        nonce: verified.check_nonce, ciphertext: verified.check_ciphertext,
      })
      // Legacy canaries have no AAD scope. Pin it only after successful
      // local verification; keep the original ciphertext and passphrase.
      if (!verified.aad_scope) {
        const pinned = await port.initializeCheck({
          nonce: verified.check_nonce, ciphertext: verified.check_ciphertext,
          scope: port.ownerScopeKey,
        }, controller.signal)
        // During a rolling Server/Web deployment an older Server may omit
        // aad_scope. The successfully verified original-origin v1 vault
        // remains usable; cross-domain support becomes available after
        // the Server is upgraded and the original browser pins its scope.
        canonicalScope = pinned.aad_scope || port.ownerScopeKey
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
      if (active.current) setBusy(false)
    }
  }

  const send = async () => {
    if (!key || !aadScope || busy) return
    setMessage('')
    try { xDriveClipboardValidateText(draft) } catch (error) {
      setMessage(errorLabel(error)); return
    }
    setBusy(true)
    const controller = new AbortController()
    writeController.current = controller
    try {
      if (pending.current?.text !== draft) {
        const client_event_id = crypto.randomUUID()
        const encrypted = await xDriveClipboardEncrypt(key, aadScope, client_event_id, draft)
        pending.current = { text: draft, item: { client_event_id, ...encrypted } }
      }
      if (!active.current || controller.signal.aborted) return
      await port.create(pending.current.item, controller.signal)
      if (!active.current || controller.signal.aborted) return
      pending.current = null
      setDraft('')
      setMessage('已加密发送至当前账号的剪贴板历史。')
      void load()
    } catch (error) {
      if (active.current && !controller.signal.aborted)
        setMessage('发送未确认；原消息 ID 保留供重试。' + errorLabel(error))
    } finally {
      if (active.current) setBusy(false)
    }
  }

  const runAction = async (action: (signal: AbortSignal) => Promise<void>, success: string) => {
    if (busy) return
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
      if (active.current) setBusy(false)
    }
  }

  const pasteFromBrowser = async () => {
    if (!port.readText || reading) return
    setReading(true)
    setMessage('')
    try {
      // Called synchronously from the click event. A read permission rejection
      // leaves the manual input untouched; no automatic OS-clipboard observer.
      const text = await port.readText()
      xDriveClipboardValidateText(text)
      if (active.current) setDraft(text)
    } catch {
      if (active.current) setMessage('浏览器未允许读取剪贴板；请直接在输入框粘贴内容。')
    } finally {
      if (active.current) setReading(false)
    }
  }

  const lock = () => {
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
        此 Web MVP 不会监听系统剪贴板，也不会自动同步密码或验证码。
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
                value={draft} onChange={event => setDraft(event.target.value)}
                helperText="最多 64 KiB；不会在浏览器本地持久保存。" />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button variant="contained" disabled={busy || !draft.length} onClick={() => { void send() }}>
                  {busy ? '处理中…' : '加密发送'}
                </Button>
                <Button variant="outlined" disabled={busy || reading || !port.readText}
                  onClick={() => { void pasteFromBrowser() }}>
                  从系统剪贴板读取
                </Button>
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
                        void port.copyText(text).then(() => {
                          if (active.current) setMessage('已复制到本机剪贴板。')
                        }).catch(error => {
                          if (active.current) setMessage(errorLabel(error))
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
