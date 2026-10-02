import { useEffect, useState } from 'react'
import { Dialog, Stack, TextField } from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

export type XDriveFileNameDialogMode = 'create-folder' | 'rename'

export function XDriveFileNameDialog({
  open,
  mode,
  initialValue = '',
  onClose,
  onSubmit,
  onError,
}: {
  open: boolean
  mode: XDriveFileNameDialogMode
  initialValue?: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
  onError?: (error: unknown) => void
}) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initialValue)
    setError('')
  }, [initialValue, mode, open])

  const title = mode === 'create-folder' ? '新建文件夹' : '重命名'
  const label = mode === 'create-folder' ? '文件夹名称' : '名称'
  const submitLabel = mode === 'create-folder' ? '创建' : '保存'
  const loadingLabel = mode === 'create-folder' ? '正在创建…' : '正在保存…'

  const close = () => {
    if (!submitting) onClose()
  }

  const submit = async () => {
    const normalized = name.trim()
    const nextError = !normalized
      ? (mode === 'create-folder' ? '请填写文件夹名称' : '请填写名称')
      : normalized.length > 255
        ? (mode === 'create-folder' ? '文件夹名称不能超过 255 个字符' : '名称不能超过 255 个字符')
        : ''
    setError(nextError)
    if (nextError) return

    setSubmitting(true)
    try {
      await onSubmit(normalized)
      onClose()
    } catch (submitError) {
      onError?.(submitError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="sm"
      fullWidth
      aria-label={title}
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title={title} onClose={close} closeDisabled={submitting} />
      <XDriveDialogContent>
        <Stack component="form" spacing={2} onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={label}
            value={name}
            error={Boolean(error)}
            helperText={error || ' '}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            onChange={(event) => {
              setName(event.target.value)
              if (error) setError('')
            }}
          />
          <XDriveActionButton
            intent="primary"
            type="submit"
            loading={submitting}
            loadingLabel={loadingLabel}
          >
            {submitLabel}
          </XDriveActionButton>
        </Stack>
      </XDriveDialogContent>
    </Dialog>
  )
}
