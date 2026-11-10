import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CircularProgress, IconButton, InputAdornment, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'

// Single password-style editor for encrypted configuration and one-time inputs.
// A stored credential is read only by an explicit authenticated, audited,
// revision-fenced onReveal callback. New and transient passwords NEVER ask
// the Server to reveal their old values.
export function XDriveSensitiveField({
  label, value, onChange, configured = false, configuredLength, revealedValue = '',
  onReveal, onHide, revealLoading = false, disabled = false, revealDisabled = false,
  placeholder, required = false, autoComplete = 'new-password',
  maxLength, helperText, onFocus, id, autoFocus = false, error = false,
  startAdornment, sx,
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  configured?: boolean
  /** Length supplied by trusted configuration metadata; never inferred from ciphertext. */
  configuredLength?: number
  revealedValue?: string
  onReveal?: () => void
  onHide?: () => void
  revealLoading?: boolean
  disabled?: boolean
  revealDisabled?: boolean
  placeholder?: string
  required?: boolean
  autoComplete?: string
  maxLength?: number
  helperText?: ReactNode
  onFocus?: () => void
  id?: string
  autoFocus?: boolean
  error?: boolean
  startAdornment?: ReactNode
  sx?: SxProps<Theme>
}) {
  const [visible, setVisible] = useState(false)
  const [editing, setEditing] = useState(false)
  const hideRef = useRef(onHide)
  useEffect(() => { hideRef.current = onHide }, [onHide])

  // A reveal is a short-lived view, never a permanently populated form value.
  // Hide even when the user continues to type or the browser loses focus.
  useEffect(() => {
    if (!visible || typeof window === 'undefined') return
    const hide = () => {
      setVisible(false)
      hideRef.current?.()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hide()
    }
    const timer = window.setTimeout(hide, 30_000)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [visible])

  // A pending edit always takes precedence over a temporary server reveal.
  // Keep a retained secret visibly populated without putting the actual secret
  // in the editable draft. A real length is used only when supplied by the API.
  // Older APIs have no length metadata, so show a neutral 8-character mask.
  const maskLength = typeof configuredLength === 'number' &&
    Number.isSafeInteger(configuredLength) && configuredLength > 0 && configuredLength <= 4096
    ? configuredLength : 8
  const retained = configured && !value && !editing
  const shownValue = value || (visible ? revealedValue : retained ? '*'.repeat(maskLength) : '')
  // Even an empty new password can switch to visible entry; only persisted
  // secrets require an explicitly supplied audited onReveal callback.
  const canToggle = !revealDisabled && !revealLoading &&
    (!configured || !!value || !!onReveal || !!revealedValue)
  const toggle = () => {
    if (visible) {
      setVisible(false)
      onHide?.()
    } else if (canToggle) {
      setVisible(true)
      if (!value && !revealedValue && configured) onReveal?.()
    }
  }

  return (
    <TextField
      fullWidth size="small" id={id} label={label}
      type={visible ? 'text' : 'password'} autoFocus={autoFocus} error={error}
      value={shownValue}
      autoComplete={autoComplete} required={required}
      helperText={helperText} onFocus={() => {
        // Focusing the empty draft clears only the visual mask, not the stored key.
        if (configured && !value && !visible) setEditing(true)
        onFocus?.()
      }}
      onBlur={() => setEditing(false)}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => {
        // Editing revealed text changes only this draft; the server does not
        // receive it until the parent explicitly saves the configuration.
        setEditing(true)
        onChange(event.target.value)
        if (revealedValue) onHide?.()
      }}
      slotProps={{
        htmlInput: { maxLength, spellCheck: false, autoCapitalize: 'off' },
        input: {
          startAdornment,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button" edge="end" size="small"
                aria-label={visible ? '隐藏' : '显示'}
                title={visible ? '隐藏' : '显示'}
                disabled={disabled || !canToggle}
                onClick={toggle}
              >
                {revealLoading ? <CircularProgress size={18} /> :
                  visible ? <VisibilityOffOutlinedIcon fontSize="small" /> :
                    <VisibilityOutlinedIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
      sx={sx}
    />
  )
}
