import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveLocalBackupSnapshot } from '../device-backups'

export interface XDriveLocalBackupSnapshotActions {
  save(sourceID: number, requestID: string): Promise<XDriveLocalBackupSnapshot>
  cancel(requestID: string): Promise<void>
}

// Only the owning Desktop may request this local private journal write.
// It must never be interpreted as a SourceRun, backup or deletion proof.
export function XDriveDeviceBackupLocalSnapshotDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupSnapshotActions
  onClose(): void
}) {
  const [snapshot, setSnapshot] = useState<XDriveLocalBackupSnapshot | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (request.current) void actions.cancel(request.current).catch(() => {})
      request.current = null
    }
  }, [actions])

  const save = async () => {
    if (saving || request.current) return
    const id = crypto.randomUUID()
    request.current = id
    setSnapshot(null)
    setError('')
    setSaving(true)
    try {
      const result = await actions.save(sourceID, id)
      if (!mounted.current || request.current !== id) return
      if (result.source_id !== sourceID || !Number.isSafeInteger(result.revision) ||
        result.revision <= 0 || !result.complete || !result.saved || result.missing_inference_safe !== false ||
        ![result.scanned_files, result.scanned_directories, result.scanned_bytes,
          result.ignored_items, result.ignored_bytes, result.skipped_unsafe_items]
          .every((value) => Number.isSafeInteger(value) && value >= 0) ||
        typeof result.has_verified_previous !== 'boolean') {
        throw new Error('本机清单保存结果不完整或 Source 身份不匹配')
      }
      setSnapshot(result)
    } catch (failure) {
      if (mounted.current && request.current === id) {
        setError('保存本机扫描清单失败：' + (failure instanceof Error ? failure.message : String(failure)))
      }
    } finally {
      if (mounted.current && request.current === id) {
        request.current = null
        setSaving(false)
      }
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机同步文件夹 · 保存扫描清单</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            手动扫描当前设备已授权的文件夹，将完整清单保存在本机私有目录。
            不上传文件、不执行同步、不创建云端历史，也不推断删除。
            取消或扫描失败时不会提交未完成的清单。
          </Alert>
          {saving ? <Typography variant="body2">正在扫描并保存本机清单，关闭可取消…</Typography> : null}
          {snapshot ? (
            <Stack spacing={0.75}>
              <Typography variant="body2">已保存完整清单 · Source 版本 {snapshot.revision}</Typography>
              <Typography variant="body2">文件 {snapshot.scanned_files.toLocaleString('zh-CN')} 项、目录 {snapshot.scanned_directories.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">扫描文件字节数：{formatBytes(snapshot.scanned_bytes)}</Typography>
              <Typography variant="body2">忽略 {snapshot.ignored_items.toLocaleString('zh-CN')} 项 · {formatBytes(snapshot.ignored_bytes)}</Typography>
              <Typography variant="body2">跳过不安全条目：{snapshot.skipped_unsafe_items.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="caption" color="text.secondary">
                {snapshot.has_verified_previous
                  ? '本机有两代已验证清单，但尚未关联服务端权威身份，不能据此删除或移动云端文件。'
                  : '目前尚无可验证的上一代清单；可以以后再次手动扫描。'}
              </Typography>
            </Stack>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={() => void save()}>
          {snapshot ? '再保存一代清单' : '开始扫描并保存'}
        </Button>
        <Button onClick={onClose}>{saving ? '取消扫描' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
