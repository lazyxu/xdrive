import { useEffect, useRef, useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyNativeDraft,
} from '../synology-backup-adapter'

// The original Agent's creating-device draft list remains read-only. The only
// mutation is one explicit, Owner-pinned and NAS-share-verified native Root
// binding to the selected existing Source. It never creates or runs a backup.
export function XDriveSynologyNativeDraftReview({
  client, ownerScope, selectionID, onBound,
}: {
  client: XDriveSynologyBackupLocalClient
  ownerScope: string
  selectionID: string
  onBound: (sourceID: number) => void
}) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    loading: boolean
    error: boolean
    items: XDriveSynologyNativeDraft[]
  }>({ loading: true, error: false, items: [] })
  const [confirmed, setConfirmed] = useState(false)
  const [workingID, setWorkingID] = useState<number | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [outcome, setOutcome] = useState<{
    id: number
    state: 'authorized' | 'needs_inspection' | 'uncertain'
  } | null>(null)
  const currentScope = useRef({ client, ownerScope, selectionID })
  const attemptedRef = useRef(false)
  // Only an Agent-confirmed bind may be retired, and only after a fresh
  // owning-device draft inventory proves that Source is no longer unbound.
  const confirmedBoundSourceRef = useRef<number | null>(null)
  const mountedRef = useRef(false)
  currentScope.current = { client, ownerScope, selectionID }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: false, items: [] })
    void client.nativeDrafts(controller.signal).then(report => {
      if (controller.signal.aborted) return
      // A previous DSM account or Server session must not appear current.
      if (report.owner_scope !== ownerScope) {
        setState({ loading: false, error: true, items: [] })
        return
      }
      if (confirmedBoundSourceRef.current !== null) {
        const boundID = confirmedBoundSourceRef.current
        if (report.items.some(item => item.source_id === boundID)) {
          // An apparently authorized Source is still reported unbound.
          // This inconsistent evidence must never unlock another mutation.
          setOutcome({ id: boundID, state: 'uncertain' })
        } else {
          confirmedBoundSourceRef.current = null
          attemptedRef.current = false
          setAttempted(false)
          setConfirmed(false)
        }
      }
      setState({ loading: false, error: false, items: report.items })
    }).catch(() => {
      if (!controller.signal.aborted) {
        setState({ loading: false, error: true, items: [] })
      }
    })
    return () => controller.abort()
  }, [client, ownerScope, revision])

  useEffect(() => {
    // A replaced Host client may point to another owning Agent even when
    // the Server Owner and share token remain textually identical.
    setConfirmed(false)
  }, [client, ownerScope, selectionID])

  const bind = (draft: XDriveSynologyNativeDraft) => {
    if (!confirmed || attemptedRef.current || workingID !== null || state.loading ||
      state.error || !/^[0-9a-f]{64}$/.test(selectionID) ||
      !/^[0-9a-f]{64}$/.test(ownerScope) ||
      !state.items.some(item => item.source_id === draft.source_id)) return
    // Never automatically retry a lost Root-binding ACK. The Server may have
    // committed the original binding even if the browser never saw its reply.
    const pinnedClient = client
    const pinnedScope = ownerScope
    const pinnedSelection = selectionID
    attemptedRef.current = true
    setAttempted(true)
    setWorkingID(draft.source_id)
    setOutcome(null)
    void client.bindNativeDraft(draft.source_id, pinnedSelection, pinnedScope).then(result => {
      if (!mountedRef.current) return
      if (currentScope.current.client !== pinnedClient ||
        currentScope.current.ownerScope !== pinnedScope ||
        currentScope.current.selectionID !== pinnedSelection) {
        setOutcome({ id: draft.source_id, state: 'uncertain' })
        return
      }
      setOutcome({ id: draft.source_id, state: result.state })
      if (result.state === 'authorized') {
        confirmedBoundSourceRef.current = draft.source_id
        onBound(draft.source_id)
        setRevision(value => value + 1)
      }
    }).catch(() => {
      if (mountedRef.current) {
        setOutcome({ id: draft.source_id, state: 'uncertain' })
      }
    }).finally(() => {
      if (mountedRef.current) setWorkingID(null)
    })
  }

  return (
    <Box data-xdrive-dsm-draft-review sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, p: 2,
    }}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle2">恢复本机未绑定的 Source 草稿</Typography>
          <Button size="small" variant="outlined" disabled={state.loading || workingID !== null}
            onClick={() => setRevision(value => value + 1)}>刷新草稿</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          仅列出原 Agent 当前建设备从未绑定过 Root 的暂停草稿；不代表已经上传任何文件。
          继续绑定必须先重新选择上方 NAS 共享目录并通过本机预检，再明确确认。
        </Typography>
        {state.loading ? (
          <Typography role="status" variant="body2">正在核对本机未绑定草稿…</Typography>
        ) : state.error ? (
          <Typography role="alert" variant="body2">
            无法可靠确认草稿或当前 Server Owner。请勿重新创建或盲目绑定，
            使用 NAS 套件用户的 xd backup drafts 检查。
          </Typography>
        ) : state.items.length === 0 ? (
          <Typography role="status" variant="body2">
            当前没有可确认的未绑定草稿；这不证明上次创建没有成功。
            请检查已授权来源以及原 Agent 的当前状态。
          </Typography>
        ) : (
          <Stack spacing={1}>
            <FormControlLabel
              control={<Checkbox size="small" checked={confirmed}
                disabled={attempted || workingID !== null || !/^[0-9a-f]{64}$/.test(selectionID)}
                onChange={event => setConfirmed(event.target.checked)} />}
              label="我确认将上方已通过预检的 NAS 目录绑定到下方选定的现有 Source，不会创建新 Source 或启动备份；每次成功绑定后须重新确认"
            />
            {state.items.map(draft => (
              <Box key={draft.source_id}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Box sx={{ flex: 1, minWidth: 150 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {draft.name}（Source {draft.source_id}）
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      创建于 {new Date(draft.created_at).toLocaleString('zh-CN')} ·
                      版本 {draft.revision} · 尚无 CAS 备份收据
                    </Typography>
                  </Box>
                  <Button size="small" variant="outlined"
                    disabled={!confirmed || attempted || workingID !== null ||
                      !/^[0-9a-f]{64}$/.test(selectionID)}
                    onClick={() => bind(draft)}>
                    {workingID === draft.source_id ? '正在绑定…' : '确认绑定这个 Source'}
                  </Button>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
        {outcome?.state === 'authorized' ? (
          <Typography role="status" variant="body2">
            Source {outcome.id} 的原生目录身份已确认；仍需在上方来源中手动运行首次备份，
            这不是任何文件已备份或 CAS 已校验的证明。
          </Typography>
        ) : null}
        {outcome?.state === 'needs_inspection' || outcome?.state === 'uncertain' ? (
          <Typography role="alert" variant="body2">
            Source {outcome.id} 的绑定结果未能可靠确认。原 Agent 可能已经完成绑定。
            请先重新检查草稿及本机来源；必要时以套件用户执行 xd backup drafts，
            不要重复点击绑定，也不要重新创建 Source。
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}
