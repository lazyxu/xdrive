import { useCallback, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { SxProps, Theme } from '@mui/material/styles'
import type {
  ExternalSourceBrowseDirectory,
  ExternalSourceDirectoryBrowser,
  SynologyPhotoSpace,
} from '../external-sources'
import {
  normalizeSynologyFileRoots,
  normalizeSynologyPhotoSpaces,
  synologyFileRootsValidationError,
  synologyPhotoSpaceOptions,
} from '../external-sources'
import { XDriveAutoLoadSentinel } from './AutoLoadSentinel'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'

function photoSpaceLabel(value: SynologyPhotoSpace) {
  return synologyPhotoSpaceOptions.find((option) => option.value === value)?.label ?? value
}

function parentRemotePath(value: string) {
  const clean = value.replace(/\/+$/, '')
  const index = clean.lastIndexOf('/')
  if (index <= 0) return ''
  return clean.slice(0, index)
}

function mergeBrowseItems(
  current: ExternalSourceBrowseDirectory[],
  incoming: ExternalSourceBrowseDirectory[],
) {
  const map = new Map(current.map((item) => [item.path, item]))
  for (const item of incoming) map.set(item.path, item)
  return Array.from(map.values())
}

export function XDriveSynologyPhotoSpacesField({
  value,
  onChange,
  error = false,
  helperText = '至少选择一个照片空间',
  label = '同步空间',
  sx,
}: {
  value: SynologyPhotoSpace[]
  onChange: (value: SynologyPhotoSpace[]) => void
  error?: boolean
  helperText?: ReactNode
  label?: ReactNode
  sx?: SxProps<Theme>
}) {
  const id = useId()
  const labelId = `${id}-label`

  return (
    <FormControl fullWidth size="small" error={error} sx={sx}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select<SynologyPhotoSpace[]>
        labelId={labelId}
        multiple
        value={value}
        input={<OutlinedInput label={label} />}
        renderValue={(selected) => selected.map(photoSpaceLabel).join('、')}
        onChange={(event: SelectChangeEvent<SynologyPhotoSpace[]>) => {
          const raw = event.target.value
          const spaces = (typeof raw === 'string' ? raw.split(',') : raw)
            .filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
          onChange(normalizeSynologyPhotoSpaces(spaces))
        }}
      >
        {synologyPhotoSpaceOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox checked={value.includes(option.value)} />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
      {helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
    </FormControl>
  )
}

export function XDriveSynologyFileRootsField({
  value,
  onChange,
  error = false,
  helperText = '每行一个 DSM 绝对目录',
  label = 'File Station 根目录',
  placeholder = '/documents\n/video/projects',
  minRows = 3,
  monospace = false,
  browse,
  browseDisabled = false,
  browseButtonLabel = '浏览群晖目录',
  sx,
}: {
  value: string[]
  onChange: (value: string[]) => void
  error?: boolean
  helperText?: ReactNode
  label?: ReactNode
  placeholder?: string
  minRows?: number
  monospace?: boolean
  browse?: ExternalSourceDirectoryBrowser
  browseDisabled?: boolean
  browseButtonLabel?: ReactNode
  sx?: SxProps<Theme>
}) {
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  const touchButtonSx = compactTouch ? { minHeight: 44, minWidth: 44 } : undefined
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browsePath, setBrowsePath] = useState('')
  const [browseItems, setBrowseItems] = useState<ExternalSourceBrowseDirectory[]>([])
  const [browseNextOffset, setBrowseNextOffset] = useState<number | undefined>()
  const [browseTotal, setBrowseTotal] = useState(0)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [draftRoots, setDraftRoots] = useState<string[]>([])
  const browseRequest = useRef(0)
  const draftRootsError = draftRoots.length > 0 ? synologyFileRootsValidationError(draftRoots) : ''

  const loadBrowsePath = useCallback(async (
    path: string,
    offset = 0,
    append = false,
  ) => {
    if (!browse) return
    const request = ++browseRequest.current
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const page = await browse(path, 200, offset)
      if (request !== browseRequest.current) return
      setBrowsePath(page.path ?? path)
      setBrowseItems((current) => append ? mergeBrowseItems(current, page.items) : page.items)
      setBrowseNextOffset(page.next_offset)
      setBrowseTotal(page.total)
    } catch (error) {
      if (request !== browseRequest.current) return
      setBrowseError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request === browseRequest.current) setBrowseLoading(false)
    }
  }, [browse])

  const openBrowser = () => {
    if (!browse || browseDisabled) return
    setDraftRoots(normalizeSynologyFileRoots(value))
    setBrowseOpen(true)
    setBrowsePath('')
    setBrowseItems([])
    setBrowseNextOffset(undefined)
    setBrowseTotal(0)
    setBrowseError('')
    void loadBrowsePath('', 0, false)
  }

  const toggleDraftRoot = (path: string) => {
    setDraftRoots((current) => {
      const normalized = normalizeSynologyFileRoots(current)
      return normalized.includes(path)
        ? normalized.filter((item) => item !== path)
        : normalizeSynologyFileRoots([...normalized, path])
    })
  }

  const closeBrowser = () => {
    browseRequest.current += 1
    setBrowseOpen(false)
    setBrowseLoading(false)
    setBrowseError('')
  }

  return (
    <>
      <Stack spacing={1} sx={sx}>
        <TextField
          fullWidth
          multiline
          minRows={minRows}
          size="small"
          label={label}
          placeholder={placeholder}
          value={value.join('\n')}
          error={error}
          helperText={helperText}
          onChange={(event) => onChange(event.target.value.split(/\r?\n/))}
          slotProps={{ htmlInput: { spellCheck: false } }}
          sx={monospace ? { '& textarea': { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace' } } : undefined}
        />
        {browse ? (
          <Box>
            <Button
              size="small"
              variant="outlined"
              sx={touchButtonSx}
              disabled={browseDisabled}
              onClick={openBrowser}
            >
              {browseButtonLabel}
            </Button>
          </Box>
        ) : null}
      </Stack>

      {browse ? (
        <Dialog
          open={browseOpen}
          onClose={closeBrowser}
          maxWidth="sm"
          fullWidth
          fullScreen={compactTouch}
          scroll="paper"
          slotProps={{ paper: dialogPaper }}
          aria-label="浏览群晖 File Station 目录"
        >
          <XDriveDialogTitle title="选择 File Station 根目录" onClose={closeBrowser} />
          <XDriveDialogContent dividers>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Button size="small" sx={touchButtonSx} onClick={() => void loadBrowsePath('', 0, false)}>
                  共享文件夹
                </Button>
                <Button
                  size="small"
                  sx={touchButtonSx}
                  disabled={!browsePath}
                  onClick={() => void loadBrowsePath(parentRemotePath(browsePath), 0, false)}
                >
                  上一级
                </Button>
                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                  {browsePath || '共享文件夹'}
                </Typography>
              </Stack>

              {browseError ? <Alert severity="error">{browseError}</Alert> : null}

              <List dense={!compactTouch} disablePadding>
                {browseItems.map((item) => {
                  const selected = draftRoots.includes(item.path)
                  return (
                    <ListItem
                      key={item.path}
                      disablePadding
                      secondaryAction={(
                        <Button
                          size="small"
                          sx={touchButtonSx}
                          onClick={() => void loadBrowsePath(item.path, 0, false)}
                        >
                          进入
                        </Button>
                      )}
                    >
                      <ListItemButton onClick={() => toggleDraftRoot(item.path)} sx={{ pr: 8, minHeight: compactTouch ? 52 : undefined }}>
                        <ListItemIcon sx={{ minWidth: 40 }}>
                          <Checkbox
                            edge="start"
                            checked={selected}
                            tabIndex={-1}
                            disableRipple
                            inputProps={{ 'aria-label': `选择 ${item.path}` }}
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={item.name}
                          secondary={item.path}
                          slotProps={{
                            primary: { sx: { overflowWrap: 'anywhere' } },
                            secondary: { sx: { wordBreak: 'break-all' } },
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  )
                })}
              </List>

              {browseLoading ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2">正在读取目录…</Typography>
                </Stack>
              ) : null}

              {!browseLoading && browseItems.length === 0 && !browseError ? (
                <Typography variant="body2" color="text.secondary">
                  当前页没有可选子目录。
                </Typography>
              ) : null}

              {browseTotal > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  已显示 {browseItems.length.toLocaleString()} / {browseTotal.toLocaleString()} 项
                </Typography>
              ) : null}
              <XDriveAutoLoadSentinel
                enabled={browseNextOffset !== undefined}
                loading={browseLoading}
                label="正在加载更多目录…"
                onLoad={() => (
                  browseNextOffset === undefined
                    ? undefined
                    : loadBrowsePath(browsePath, browseNextOffset, true)
                )}
              />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  已选择 {draftRoots.length} 个根目录
                </Typography>
                {draftRootsError ? <Alert severity="warning" sx={{ mb: 1 }}>{draftRootsError}</Alert> : null}
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                  {draftRoots.length ? draftRoots.map((root) => compactTouch ? (
                    <Stack
                      key={root}
                      direction="row"
                      alignItems="flex-start"
                      sx={{ width: '100%', minWidth: 0, pl: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5 }}
                    >
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, py: 1.25, overflowWrap: 'anywhere' }}>
                        {root}
                      </Typography>
                      <IconButton
                        aria-label={'移除 ' + root}
                        size="small"
                        sx={{ width: 44, height: 44, flex: '0 0 auto' }}
                        onClick={() => toggleDraftRoot(root)}
                      >
                        <CloseRoundedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : (
                    <Chip
                      key={root}
                      size="small"
                      label={root}
                      onDelete={() => toggleDraftRoot(root)}
                    />
                  )) : (
                    <Typography variant="body2" color="text.secondary">
                      尚未选择目录。
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </XDriveDialogContent>
          <XDriveDialogActions>
            <Button sx={touchButtonSx} onClick={closeBrowser}>取消</Button>
            <Button
              variant="contained"
              sx={touchButtonSx}
              disabled={browseLoading || draftRoots.length === 0 || Boolean(draftRootsError)}
              onClick={() => {
                onChange(normalizeSynologyFileRoots(draftRoots))
                closeBrowser()
              }}
            >
              使用所选目录
            </Button>
          </XDriveDialogActions>
        </Dialog>
      ) : null}
    </>
  )
}
