import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveSynologyNASShare } from '../synology-nas-share-inventory'
import { XDriveSynologyNASShareInventory } from './SynologyNASShareInventory'
import { XDriveSynologyBackupTargetBrowser } from './SynologyBackupTargetBrowser'
import { XDriveSynologyNativeDraftReview } from './SynologyNativeDraftReview'

type CreateStatus = 'idle' | 'creating' | 'authorized' | 'needs_inspection' | 'uncertain'
type Target = { id: number; name: string }

// One opt-in section in the original shared Device Backup page. DSM never
// owns another backup Runner, Source store or native file browser. The form
// sends only verified opaque share/Owner identities and a cloud directory ID.
export function XDriveSynologyBackupSourceSetup({
  client, onCreated,
}: {
  client: XDriveSynologyBackupLocalClient
  onCreated: () => void
}) {
  const [ownerScope, setOwnerScope] = useState('')
  const [scopeStatus, setScopeStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [scopeRevision, setScopeRevision] = useState(0)
  const [selectedShare, setSelectedShare] = useState<XDriveSynologyNASShare | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<CreateStatus>('idle')
  const [createdID, setCreatedID] = useState<number | null>(null)
  const [showDrafts, setShowDrafts] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setOwnerScope('')
    setScopeStatus('checking')
    setSelectedTarget(null)
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

  const onVerifiedShare = useCallback((share: XDriveSynologyNASShare | null) => {
    setSelectedShare(share)
    setConfirmed(false)
  }, [])
  const onSelectTarget = useCallback((target: Target | null) => {
    setSelectedTarget(target)
    setConfirmed(false)
  }, [])
  const create = () => {
    if (status !== 'idle' || scopeStatus !== 'ready' ||
      !/^[0-9a-f]{64}$/.test(ownerScope) ||
      !selectedShare || !selectedTarget || !confirmed ||
      name.trim() !== name || name.length < 1 ||
      new TextEncoder().encode(name).length > 128) return
    // A single deliberate click submits once. Any lost reply may have
    // created a paused Source; never automatically retry or assume success.
    setStatus('creating')
    setCreatedID(null)
    void client.createNASBackupSource(
      selectedShare.selection_id, ownerScope, selectedTarget.id, name,
    ).then(result => {
      setCreatedID(result.source_id)
      setStatus(result.state)
      if (result.state === 'authorized') onCreated()
      if (result.state === 'needs_inspection') setShowDrafts(true)
    }).catch(() => {
      setStatus('uncertain')
      setShowDrafts(true)
    })
  }

  return (
    <Box data-xdrive-dsm-source-setup sx={{ display: 'grid', gap: 1.5 }}>
      <XDriveSynologyNASShareInventory client={client} onVerifiedShare={onVerifiedShare} />
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>创建 NAS 本机备份来源</Typography>
          <Typography variant="body2" color="text.secondary">
            必须先由本机 Agent 验证 NAS 共享目录，再选择当前 Server Owner 的云端文件夹。
            创建时将登记暂停的 Source 并请求 Agent 原生 Root 授权，不会自动上传或启动备份。
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Button variant="outlined" size="small"
              disabled={status === 'creating'}
              onClick={() => {
                if (status !== 'idle') return
                setSelectedTarget(null)
                setTargetOpen(v => !v)
              }}>
              {targetOpen ? '收起云端目标' : '选择云端备份目标'}
            </Button>
            <Button variant="text" size="small"
              disabled={scopeStatus === 'checking' || status !== 'idle'}
              onClick={() => setScopeRevision(n => n + 1)}>
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
          {targetOpen ? (
            <XDriveSynologyBackupTargetBrowser client={client} onSelectTarget={onSelectTarget} />
          ) : null}
          {selectedShare ? (
            <Typography variant="body2">已通过本机预检：{selectedShare.label}</Typography>
          ) : <Typography variant="body2" color="text.secondary">尚未选择并通过本地 NAS 目录预检。</Typography>}
          {selectedTarget ? (
            <Typography variant="body2">已选择云端目录：{selectedTarget.name}（ID {selectedTarget.id}）</Typography>
          ) : <Typography variant="body2" color="text.secondary">尚未确认云端目标目录。</Typography>}
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
          <Box>
            <Button variant="contained" disabled={status !== 'idle' ||
              scopeStatus !== 'ready' || !selectedShare || !selectedTarget ||
              !confirmed || !name.trim() || name.trim() !== name}
              onClick={create}>
              {status === 'creating' ? '正在创建来源…' : '确认创建并绑定本地目录'}
            </Button>
          </Box>
          {status === 'creating' ? (
            <Typography role="status">正在通过本机 Agent 创建暂停的 Source 并绑定原生 Root…</Typography>
          ) : null}
          {status === 'authorized' ? (
            <Typography role="status" color="success.main">
              本机 Source {createdID} 已原生授权。可在上方来源列表手动执行首次备份；尚未验证任何上传收据。
            </Typography>
          ) : null}
          {status === 'needs_inspection' ? (
            <Typography role="alert" color="text.secondary">
              Source {createdID} 已创建，但原生 Root 绑定结果尚未确认，可能仍为暂停草稿。
              请先使用下方只读草稿检查核对；如需恢复绑定，仍须在 NAS 本机以套件用户执行原有 xd backup bind。
              勿再次点击创建。
            </Typography>
          ) : null}
          {status === 'uncertain' ? (
            <Typography role="alert" color="text.secondary">
              创建结果无法确认；Server 可能已经保留暂停的 Source。不要重试创建。
              请检查下方未绑定草稿与上方已授权来源；无法确认时，再通过 NAS 本机 xd 检查。
            </Typography>
          ) : null}
          {showDrafts && scopeStatus === 'ready' ? (
            <XDriveSynologyNativeDraftReview client={client} ownerScope={ownerScope} />
          ) : null}
        </Stack>
      </Box>
    </Box>
  )
}
