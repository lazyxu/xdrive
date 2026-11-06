import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveSynologyNASShare } from '../synology-nas-share-inventory'
import { XDriveSynologyNASShareInventory } from './SynologyNASShareInventory'
import { XDriveSynologyNativeDraftReview } from './SynologyNativeDraftReview'

type CreateStatus = 'idle' | 'creating' | 'authorized' | 'needs_inspection' | 'uncertain'

// One opt-in section in the original shared Device Backup page. DSM never
// owns another backup Runner, Source store or native file browser. The form
// sends only verified opaque share/Owner identities and a display name; the
// Server provisions the exclusive cloud destination from the enrolled device.
// The Source creation form is an Owner/Host-local transaction, not reusable
// form state. A different owning Agent must get a fresh React subtree *during*
// reconciliation, before passive effects or a prior Source ACK can render.
// Weak keys preserve same-Agent state across ordinary local list refreshes.
const sourceSetupHostKeys = new WeakMap<XDriveSynologyBackupLocalClient, number>()
let nextSourceSetupHostKey = 0
function sourceSetupHostKey(client: XDriveSynologyBackupLocalClient): number {
  let key = sourceSetupHostKeys.get(client)
  if (key === undefined) {
    key = ++nextSourceSetupHostKey
    sourceSetupHostKeys.set(client, key)
  }
  return key
}

export function XDriveSynologyBackupSourceSetup(props: {
  client: XDriveSynologyBackupLocalClient
  onCreated: () => void
}) {
  return <XDriveSynologyBackupSourceSetupForHost
    key={sourceSetupHostKey(props.client)} {...props} />
}

function XDriveSynologyBackupSourceSetupForHost({
  client, onCreated,
}: {
  client: XDriveSynologyBackupLocalClient
  onCreated: () => void
}) {
  const [ownerScope, setOwnerScope] = useState('')
  const [scopeStatus, setScopeStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [scopeRevision, setScopeRevision] = useState(0)
  const [shareRevision, setShareRevision] = useState(0)
  const [selectedShare, setSelectedShare] = useState<XDriveSynologyNASShare | null>(null)
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  // Opt-in only: creating a Source never silently begins a NAS transfer.
  const [enableAutoAfterCreate, setEnableAutoAfterCreate] = useState(false)
  const [autoResult, setAutoResult] = useState<'none' | 'accepted' | 'needs_attention'>('none')
  const [status, setStatus] = useState<CreateStatus>('idle')
  const [createdID, setCreatedID] = useState<number | null>(null)
  const [showDrafts, setShowDrafts] = useState(false)
  // React state updates are asynchronous; this guard closes the double-click
  // window before the first Owner-backed Source mutation gets an ACK.
  const createAttemptedRef = useRef(false)
  const shareRevisionRef = useRef(0)
  const mountedRef = useRef(false)
  const latestScopeRef = useRef({ client, ownerScope })
  latestScopeRef.current = { client, ownerScope }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setOwnerScope('')
    setScopeStatus('checking')
    setSelectedShare(null)
    setConfirmed(false)
    setShowDrafts(false)
    void client.serverConnection(controller.signal).then(info => {
      if (controller.signal.aborted) return
      if (!info.configured || info.must_change_password ||
        !/^[0-9a-f]{64}$/.test(info.owner_scope)) {
        setScopeStatus('unavailable')
        return
      }
      setOwnerScope(info.owner_scope)
      setScopeStatus('ready')
    }).catch(() => {
      if (!controller.signal.aborted) setScopeStatus('unavailable')
    })
    return () => controller.abort()
  }, [client, scopeRevision])

  // A confirmed Source/Root bind must not leave the previous native share
  // preflight valid for a distinct Source. Rotate synchronously to also
  // reject an old NAS inventory callback that resolves after the reset.
  const resetShareAuthorization = () => {
    shareRevisionRef.current += 1
    setShareRevision(shareRevisionRef.current)
    setSelectedShare(null)
    setConfirmed(false)
  }
  const onVerifiedShare = useCallback((share: XDriveSynologyNASShare | null) => {
    if (createAttemptedRef.current || shareRevision !== shareRevisionRef.current) return
    setSelectedShare(share)
    setConfirmed(false)
  }, [shareRevision])
  const onNativeDraftBound = (sourceID: number) => {
    // A draft binding is a distinct native Root mutation, even if the
    // selected directory label is unchanged. Force a new Agent preflight
    // and fresh explicit share selection before binding another draft.
    resetShareAuthorization()
    if (status === 'needs_inspection' && createdID === sourceID) {
      // This particular previously uncertain Source now has a confirmed
      // strong native Root grant. Another Source is safe to configure.
      setStatus('authorized')
    }
    onCreated()
  }

  const create = () => {
    if (status !== 'idle' || createAttemptedRef.current ||
      scopeStatus !== 'ready' || !/^[0-9a-f]{64}$/.test(ownerScope) ||
      !selectedShare || !confirmed ||
      name.trim() !== name || name.length < 1 ||
      new TextEncoder().encode(name).length > 128) return
    // A single deliberate click submits once, synchronously locked. Any lost
    // reply may have created a paused Source: never auto-retry.
    createAttemptedRef.current = true
    const pinnedClient = client
    const pinnedOwnerScope = ownerScope
    const explicitlyEnableAuto = enableAutoAfterCreate
    const sameOwningHost = () => mountedRef.current &&
      latestScopeRef.current.client === pinnedClient &&
      latestScopeRef.current.ownerScope === pinnedOwnerScope
    setStatus('creating')
    setCreatedID(null)
    setAutoResult('none')
    void client.createNASBackupSource(
      selectedShare.selection_id, ownerScope, name,
    ).then(async result => {
      if (!mountedRef.current) return
      if (!sameOwningHost()) {
        setStatus('uncertain')
        setShowDrafts(true)
        return
      }
      setCreatedID(result.source_id)
      if (result.state !== 'authorized') {
        setStatus(result.state)
        if (result.state === 'needs_inspection') setShowDrafts(true)
        return
      }
      // The native Root grant is independently verified by the owning Agent.
      // Refresh the existing Source list even if a later schedule write fails.
      onCreated()
      if (!explicitlyEnableAuto) {
        setStatus('authorized')
        return
      }
      // One explicit user action: preserve Source identity, save a 6h plan,
      // then start the ORIGINAL Agent's existing incremental Source runner.
      // A lost schedule/run ACK is never retried or represented as success.
      try {
        const initial = await pinnedClient.load(result.source_id)
        if (!sameOwningHost()) {
          setStatus('uncertain')
          return
        }
        if (initial.source_id !== result.source_id ||
          !Number.isSafeInteger(initial.revision) || initial.revision <= 0 ||
          !['', 'manual', 'interval', 'cron'].includes(initial.schedule_type)) {
          throw new Error('unverified owning Source schedule')
        }
        if (initial.schedule_type !== 'interval' ||
          initial.schedule_expression !== '6h' ||
          initial.schedule_timezone !== '') {
          const saved = await pinnedClient.save(result.source_id, initial.revision, {
            schedule_type: 'interval', schedule_expression: '6h', schedule_timezone: '',
          })
          if (!sameOwningHost()) {
            setStatus('uncertain')
            return
          }
          if (saved.source_id !== result.source_id ||
            !Number.isSafeInteger(saved.revision) ||
            saved.revision <= initial.revision ||
            saved.schedule_type !== 'interval' ||
            saved.schedule_expression !== '6h' || saved.schedule_timezone !== '') {
            throw new Error('unverified NAS schedule update')
          }
        }
        if (!sameOwningHost()) {
          setStatus('uncertain')
          return
        }
        const started = await pinnedClient.run(result.source_id)
        if (!sameOwningHost()) {
          setStatus('uncertain')
          return
        }
        if (started.source_id !== result.source_id ||
          (started.state !== 'running' && started.state !== 'partial') ||
          started.running !== (started.state === 'running') ||
          started.uncertain_files !== 0 ||
          started.backup_complete !== false ||
          started.retirement_safe !== false ||
          started.current_cas_verified !== false) {
          throw new Error('NAS Agent did not confirm its first run')
        }
        setAutoResult('accepted')
      } catch {
        // Native Source and Root are confirmed, but we cannot infer whether
        // the schedule or original upload committed after a lost reply.
        setAutoResult('needs_attention')
      }
      if (sameOwningHost()) setStatus('authorized')
    }).catch(() => {
      if (!mountedRef.current) return
      setStatus('uncertain')
      setShowDrafts(true)
    })
  }

  // Only a *confirmed* successful native Root grant permits a separate new
  // Source. Fresh Owner verification, share preflight and explicit consent
  // are required again. Uncertain/create-in-flight is never reset.
  const configureAnother = () => {
    if (status !== 'authorized' || !createAttemptedRef.current) return
    createAttemptedRef.current = false
    setStatus('idle')
    setCreatedID(null)
    resetShareAuthorization()
    setName('')
    setEnableAutoAfterCreate(false)
    setAutoResult('none')
    setShowDrafts(false)
    setScopeRevision(value => value + 1)
  }

  return (
    <Box data-xdrive-dsm-source-setup sx={{ display: 'grid', gap: 1.5 }}>
      <XDriveSynologyNASShareInventory key={shareRevision}
        client={client} onVerifiedShare={onVerifiedShare} />
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>创建 NAS 本机备份来源</Typography>
          <Typography variant="body2" color="text.secondary">
            先由本机 Agent 验证 NAS 共享目录。云端目标由 Server 根据已绑定设备和来源名称自动创建专属目录，
            不需要选择普通云端文件夹。创建时先登记 Source 并验证本机 Root；只有明确勾选自动备份选项才会提交首轮上传。
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Button variant="text" size="small"
              disabled={scopeStatus === 'checking' || status !== 'idle'}
              onClick={() => {
                resetShareAuthorization()
                setScopeRevision(n => n + 1)
              }}>
              重新验证 Server Owner
            </Button>
            <Button variant="text" size="small"
              disabled={scopeStatus !== 'ready' || status === 'creating'}
              onClick={() => setShowDrafts(value => !value)}>
              {showDrafts ? '收起未绑定草稿' : '检查未绑定草稿'}
            </Button>
          </Stack>
          {scopeStatus === 'checking' ? (
            <Typography role="status">正在检查当前 Agent 的 Server Owner…</Typography>
          ) : scopeStatus === 'unavailable' ? (
            <Typography role="alert" color="text.secondary">
              当前 Server Owner 身份未验证，请先在共享设置里登录。无法创建新的 NAS Source。
            </Typography>
          ) : null}
          {selectedShare ? (
            <Typography variant="body2">已通过本机预检：{selectedShare.label}</Typography>
          ) : <Typography variant="body2" color="text.secondary">尚未选择并通过本地 NAS 目录预检。</Typography>}
          <Typography variant="body2" color="text.secondary">
            云端目标由 Server 自动创建并独占管理；具体目录以返回的 Source 目标路径为准。
          </Typography>
          <TextField size="small" label="备份来源名称" value={name}
            disabled={status !== 'idle'} inputProps={{ maxLength: 128 }}
            onChange={event => {
              setName(event.target.value)
              setConfirmed(false)
            }} />
          <FormControlLabel
            control={<Checkbox size="small" checked={confirmed}
              disabled={status !== 'idle'}
              onChange={event => setConfirmed(event.target.checked)} />}
            label="我确认在当前 NAS 上将所选目录授权给当前 xDrive Server Owner 作为备份来源" />
          <FormControlLabel
            control={<Checkbox size="small" checked={enableAutoAfterCreate}
              disabled={status !== 'idle'}
              onChange={event => setEnableAutoAfterCreate(event.target.checked)} />}
            label="创建并授权后，每 6 小时自动增量备份，并立即启动首次备份（推荐，需明确勾选）" />
          <Box>
            <Button variant="contained" disabled={status !== 'idle' ||
              scopeStatus !== 'ready' || !selectedShare ||
              !confirmed || !name.trim() || name.trim() !== name}
              onClick={create}>
              {status === 'creating' ? '正在创建来源…' : '确认创建并绑定本地目录'}
            </Button>
          </Box>
          {status === 'creating' ? (
            <Typography role="status">
              {createdID && enableAutoAfterCreate
                ? '本机目录已授权，正在验证计划并请求首次增量备份…'
                : '正在通过本机 Agent 创建 Source 并绑定原生 Root…'}
            </Typography>
          ) : null}
          {status === 'authorized' ? (
            <Stack spacing={1}>
              <Typography role="status" color="success.main">
                本机 Source {createdID} 已原生授权。
                {autoResult === 'accepted'
                  ? ' 已配置每 6 小时增量计划，首次任务已由本机 Agent 接受。只有首轮产生可信检查点后后续计划才会生效；请在上方状态/历史检查逐文件上传结果。'
                  : autoResult === 'needs_attention'
                    ? ' 请先核对当前来源的计划和执行历史，勿盲目重新提交。'
                    : ' 请在上方来源列表检查计划，并手动启动首次备份。'}
              </Typography>
              {autoResult === 'needs_attention' ? (
                <Typography role="alert" color="warning.main">
                  本机目录授权成功，但自动计划或首次备份的结果未确认。请核对该 Source 的计划、状态和历史，
                  不要重复创建来源或盲目重试不确定的上传操作。
                </Typography>
              ) : null}
              <Button variant="outlined" size="small" onClick={configureAnother}>
                配置另一个 NAS 备份来源
              </Button>
            </Stack>
          ) : null}
          {status === 'needs_inspection' ? (
            <Typography role="alert" color="text.secondary">
              Source {createdID} 已创建，但原生 Root 绑定结果尚未确认，可能仍为暂停草稿。
              请先检查下方原建设备草稿，并在确认目录与当前 Owner 后通过 DSM 恢复绑定；
              若无法确认，使用 NAS 套件用户的 xd backup drafts 检查。勿再次点击创建。
            </Typography>
          ) : null}
          {status === 'uncertain' ? (
            <Typography role="alert" color="text.secondary">
              创建结果无法确认；Server 可能已经保留暂停的 Source。不要重试创建。
              请检查下方未绑定草稿与上方已授权来源；无法确认时，再通过 NAS 本机 xd 检查。
            </Typography>
          ) : null}
          {showDrafts && scopeStatus === 'ready' ? (
            <XDriveSynologyNativeDraftReview
              client={client} ownerScope={ownerScope}
              selectionID={selectedShare?.selection_id ?? ''}
              onBound={onNativeDraftBound}
            />
          ) : null}
        </Stack>
      </Box>
    </Box>
  )
}
