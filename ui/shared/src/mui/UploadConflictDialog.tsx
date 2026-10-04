import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Checkbox,
  Dialog,
  DialogContentText,
  FormControlLabel,
  Stack,
} from '@mui/material'
import type {
  XDriveUploadConflictDecision,
  XDriveUploadConflictResolution,
} from '../upload-conflicts'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

export function XDriveUploadConflictDialog({
  open,
  fileName,
  applyToRemaining,
  onApplyToRemainingChange,
  onCancel,
  onSkip,
  onKeepBoth,
}: {
  open: boolean
  fileName: string
  applyToRemaining: boolean
  onApplyToRemainingChange: (checked: boolean) => void
  onCancel: () => void
  onSkip: () => void
  onKeepBoth: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-label="上传同名文件处理"
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title="目标位置已有同名文件" onClose={onCancel} />
      <XDriveDialogContent>
        <Stack spacing={1.5}>
          <DialogContentText component="div">
            “{fileName}”已存在。可以跳过这个文件，或保留两者并让 xDrive 自动生成副本名称。
          </DialogContentText>
          <FormControlLabel
            control={(
              <Checkbox
                checked={applyToRemaining}
                onChange={(event) => onApplyToRemainingChange(event.target.checked)}
              />
            )}
            label="对本次剩余同名文件执行相同操作"
          />
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onCancel}>取消本次上传</XDriveActionButton>
        <XDriveActionButton onClick={onSkip}>跳过</XDriveActionButton>
        <XDriveActionButton intent="primary" onClick={onKeepBoth}>保留两者</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}

type PendingUploadConflict = {
  fileName: string
  resolve: (decision: XDriveUploadConflictDecision) => void
}

export function useXDriveUploadConflictResolver() {
  const pendingRef = useRef<PendingUploadConflict | null>(null)
  const stickyPolicyRef = useRef<XDriveUploadConflictResolution | null>(null)
  const batchActiveRef = useRef(false)
  const [fileName, setFileName] = useState('')
  const [applyToRemaining, setApplyToRemaining] = useState(false)

  const finish = useCallback((decision: XDriveUploadConflictDecision) => {
    const pending = pendingRef.current
    pendingRef.current = null
    setFileName('')
    setApplyToRemaining(false)
    pending?.resolve(decision)
  }, [])

  const beginBatch = useCallback(() => {
    if (batchActiveRef.current) return false
    batchActiveRef.current = true
    stickyPolicyRef.current = null
    return true
  }, [])

  const endBatch = useCallback(() => {
    batchActiveRef.current = false
    stickyPolicyRef.current = null
  }, [])

  const resolveConflict = useCallback((nextFileName: string) => {
    const sticky = stickyPolicyRef.current
    if (sticky) return Promise.resolve<XDriveUploadConflictDecision>(sticky)
    if (pendingRef.current) return Promise.resolve<XDriveUploadConflictDecision>('cancel')
    return new Promise<XDriveUploadConflictDecision>((resolve) => {
      pendingRef.current = { fileName: nextFileName, resolve }
      setFileName(nextFileName)
      setApplyToRemaining(false)
    })
  }, [])

  const choose = useCallback((policy: XDriveUploadConflictResolution) => {
    if (applyToRemaining) stickyPolicyRef.current = policy
    finish(policy)
  }, [applyToRemaining, finish])

  useEffect(() => () => {
    pendingRef.current?.resolve('cancel')
    pendingRef.current = null
    batchActiveRef.current = false
  }, [])

  return {
    beginBatch,
    endBatch,
    resolveConflict,
    dialogProps: {
      open: Boolean(fileName),
      fileName,
      applyToRemaining,
      onApplyToRemainingChange: setApplyToRemaining,
      onCancel: () => finish('cancel'),
      onSkip: () => choose('skip'),
      onKeepBoth: () => choose('keep_both'),
    },
  }
}
