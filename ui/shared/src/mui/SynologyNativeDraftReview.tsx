import { useEffect, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyNativeDraft,
} from '../synology-backup-adapter'

// Read-only recovery inside the shared Device Backup page. This never
// guesses the outcome of an uncertain Source create/bind acknowledgement and
// cannot mint a device credential, retry Create or grant a native Root.
export function XDriveSynologyNativeDraftReview({
  client, ownerScope,
}: {
  client: XDriveSynologyBackupLocalClient
  ownerScope: string
}) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    loading: boolean
    error: boolean
    items: XDriveSynologyNativeDraft[]
  }>({ loading: true, error: false, items: [] })

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
      setState({ loading: false, error: false, items: report.items })
    }).catch(() => {
      if (!controller.signal.aborted) {
        setState({ loading: false, error: true, items: [] })
      }
    })
    return () => controller.abort()
  }, [client, ownerScope, revision])

  return (
    <Box data-xdrive-dsm-draft-review sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, p: 2,
    }}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle2">检查本机未绑定的 Source 草稿（只读）</Typography>
          <Button size="small" variant="outlined" disabled={state.loading}
            onClick={() => setRevision(value => value + 1)}>刷新草稿</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          仅显示当前 Agent 和 Server Owner 下，这台设备创建、从未绑定过 Root 的暂停草稿。
          这里不能重新授权、删除或启动备份，任何草稿也不代表文件已上传。
        </Typography>
        {state.loading ? (
          <Typography role="status" variant="body2">正在核对本机未绑定草稿…</Typography>
        ) : state.error ? (
          <Typography role="alert" variant="body2">
            无法可靠确认本机草稿或当前 Owner，请不要重试创建来源。
            请先在 NAS 上以 xdrivenas 套件用户运行 xd backup drafts 检查。
          </Typography>
        ) : state.items.length === 0 ? (
          <Typography role="status" variant="body2">
            当前没有可确认的未绑定草稿。这不代表创建一定失败：来源可能已完成绑定，
            请检查上方本机来源及其状态，勿直接重新创建。
          </Typography>
        ) : (
          <Stack spacing={1}>
            {state.items.map(draft => (
              <Box key={draft.source_id}>
                <Typography variant="body2" fontWeight={600}>
                  {draft.name}（Source {draft.source_id}）
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  创建于 {new Date(draft.created_at).toLocaleString('zh-CN')} ·
                  版本 {draft.revision} · 未绑定，未验证任何 CAS 收据
                </Typography>
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">
              需要继续授权时，按原有 NAS 本机 xd backup bind --source ID --path ABS_DIR
              流程操作；必须由同一 xdrivenas 套件用户执行，并重新选择真实目录。
              不能根据同名草稿自动绑定、覆盖或删除来源。
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
