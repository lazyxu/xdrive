import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Box, Button, Dialog, Stack, TextField } from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

export type XDriveFileNameDialogMode = 'create-folder' | 'rename' | 'saved-search'

export function xDriveFileNameValidationError(name: string, mode: XDriveFileNameDialogMode): string {
  const normalized = name.trim()
  if (!normalized) return mode === 'create-folder' ? '请填写文件夹名称' : '请填写名称'
  const maxBytes = mode === 'saved-search' ? 128 : 255
  if (new TextEncoder().encode(normalized).length <= maxBytes) return ''
  const label = mode === 'create-folder' ? '文件夹名称' : mode === 'saved-search' ? '智能文件夹名称' : '名称'
  return label + '不能超过 ' + maxBytes + ' 个 UTF-8 字节（中文等字符会占多个字节）'
}

/** Shared presentation for a name editor whose caller already owns its draft and submission. */
export function XDriveFileNameDialogView({
  open,
  mode,
  name,
  error,
  submitting,
  inputRef,
  onNameChange,
  onSubmit,
  onClose,
  disableRestoreFocus = false,
}: {
  open: boolean
  mode: XDriveFileNameDialogMode
  name: string
  error: string
  submitting: boolean
  inputRef?: Ref<HTMLInputElement>
  onNameChange: (name: string) => void
  onSubmit: () => void
  onClose: () => void
  disableRestoreFocus?: boolean
}) {
  const title = mode === 'create-folder' ? '新建文件夹' : mode === 'saved-search' ? '保存搜索' : '重命名'
  const label = mode === 'create-folder' ? '文件夹名称' : mode === 'saved-search' ? '智能文件夹名称' : '名称'
  const submitLabel = mode === 'create-folder' ? '创建' : '保存'
  const loadingLabel = mode === 'create-folder' ? '正在创建…' : '正在保存…'
  const close = () => {
    if (!submitting) onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="sm"
      fullWidth
      disableRestoreFocus={disableRestoreFocus}
      aria-label={title}
      slotProps={{ paper: { sx: {
        ...xDriveDialogPaperProps.sx,
        minHeight: 0,
        '@media (max-width:899.95px)': {
          m: 1,
          width: 'calc(100% - 16px)',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)',
          '& .MuiDialogTitle-root': { flexShrink: 0, px: 1.5, py: 1.25, minHeight: 56 },
          '& .MuiDialogTitle-root .MuiIconButton-root': { width: 44, height: 44 },
          '& .MuiButton-root': { minHeight: 44, minWidth: 44, whiteSpace: 'normal' },
        },
      } } }}
    >
      <XDriveDialogTitle title={title} onClose={close} closeDisabled={submitting} />
      <Box component="form" sx={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}>
        <XDriveDialogContent>
          <TextField
            inputRef={inputRef}
            autoFocus
            fullWidth
            size="small"
            label={label}
            value={name}
            disabled={submitting}
            error={Boolean(error)}
            helperText={error || ' '}
            slotProps={{ formHelperText: { role: error ? 'alert' : undefined, sx: { overflowWrap: 'anywhere' } } }}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </XDriveDialogContent>
        <Stack direction="row" justifyContent="flex-end" gap={1} sx={{ flexShrink: 0, p: 1.5, flexWrap: 'wrap' }}>
          <Button onClick={close} disabled={submitting}>取消</Button>
          <XDriveActionButton intent="primary" type="submit" loading={submitting} loadingLabel={loadingLabel}>
            {submitLabel}
          </XDriveActionButton>
        </Stack>
      </Box>
    </Dialog>
  )
}

export function XDriveFileNameDialog({
  open,
  mode,
  initialValue = '',
  lifecycleKey,
  onClose,
  onSubmit,
  onError,
}: {
  open: boolean
  mode: XDriveFileNameDialogMode
  initialValue?: string
  lifecycleKey?: string | number
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
  onError?: (error: unknown) => void
}) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const lifecycleRef = useRef(0)

  useEffect(() => {
    lifecycleRef.current += 1
    submittingRef.current = false
    setSubmitting(false)
    if (open) {
      setName(initialValue)
      setError('')
    }
    return () => {
      lifecycleRef.current += 1
    }
  }, [initialValue, lifecycleKey, mode, open])

  const close = () => {
    if (!submittingRef.current) onClose()
  }

  const submit = async () => {
    if (!open || submittingRef.current) return
    const normalized = name.trim()
    const nextError = xDriveFileNameValidationError(normalized, mode)
    setError(nextError)
    if (nextError) return
    const lifecycle = lifecycleRef.current
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onSubmit(normalized)
      if (lifecycle === lifecycleRef.current) onClose()
    } catch (submitError) {
      if (lifecycle !== lifecycleRef.current) return
      setError((submitError instanceof Error ? submitError.message : String(submitError)) || '保存失败，请重试。')
      onError?.(submitError)
    } finally {
      if (lifecycle === lifecycleRef.current) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  return (
    <XDriveFileNameDialogView
      open={open}
      mode={mode}
      name={name}
      error={error}
      submitting={submitting}
      onNameChange={(value) => {
        setName(value)
        if (error) setError('')
      }}
      onSubmit={() => { void submit() }}
      onClose={close}
    />
  )
}
