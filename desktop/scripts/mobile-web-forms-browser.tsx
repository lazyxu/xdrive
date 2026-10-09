import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Box, Dialog, Stack, TextField } from '@mui/material'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import { XDriveActionButton } from '__ACTION__'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from '__TITLE__'
import { XDriveDialogContent } from '__CONTENT__'
import { XDriveSynologyFileRootsField } from '__ROOTS__'
import { XDriveSourceSummaryCard } from '__CARD__'
import { XDriveFileNameDialog } from '__FILENAME__'
import { XDriveUploadConflictDialog } from '__UPLOAD__'

// Only platform data/callbacks are fixtures. All fields, buttons, Dialogs,
// keyboard handling, selection and responsive presentation are production MUI.
const longName = `Archive_${'a'.repeat(110)}`
const longPath = `/${longName}`
const harness = ((window as any).mobileFormsHarness = {
  events: [] as { type: string; value?: unknown }[],
  browseCalls: [] as string[],
  longName,
  longPath,
}) as any
const record = (type: string, value?: unknown) => harness.events.push({ type, value })
const browse = async (path: string) => {
  harness.browseCalls.push(path)
  if (path === '') return {
    path, total: 2,
    items: [{ name: longName, path: longPath }, { name: 'short', path: '/short' }],
  }
  if (path === longPath) return {
    path, total: 1, items: [{ name: 'child', path: `${longPath}/child` }],
  }
  throw new Error(`Unexpected fixture directory: ${path}`)
}

function Fixture() {
  const mode = new URLSearchParams(location.search).get('case') || 'controls'
  const [roots, setRoots] = useState<string[]>([])
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState('resize-keeps-this-draft')
  const [applyToRemaining, setApplyToRemaining] = useState(false)
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  harness.state = { roots, open, draft, applyToRemaining }
  const close = () => { record('close'); setOpen(false) }
  const decide = (choice: string) => { record('upload-decision', choice); setOpen(false) }

  if (mode === 'title') return (
    <Dialog open={open} fullScreen={compactTouch} fullWidth maxWidth="sm" slotProps={{ paper: dialogPaper }}>
      <XDriveDialogTitle title={`${longName} · 设置`} onClose={close} />
      <XDriveDialogContent>
        <TextField label="测试设置值" fullWidth value={draft} onChange={(event) => setDraft(event.target.value)} />
      </XDriveDialogContent>
    </Dialog>
  )
  if (mode === 'filename') return (
    <XDriveFileNameDialog
      open={open}
      mode="create-folder"
      onClose={close}
      onSubmit={async (name: string) => { record('name-submit', name) }}
    />
  )
  if (mode === 'upload') return (
    <XDriveUploadConflictDialog
      open={open}
      fileName="测试同名文件.txt"
      applyToRemaining={applyToRemaining}
      canOverwrite
      onApplyToRemainingChange={setApplyToRemaining}
      onCancel={() => decide('cancel')}
      onSkip={() => decide('skip')}
      onKeepBoth={() => decide('keep-both')}
      onOverwrite={() => decide('overwrite')}
    />
  )
  return (
    <Box sx={{ p: 2, width: '100%', minWidth: 0 }}>
      {mode === 'roots' ? (
        <XDriveSynologyFileRootsField
          value={roots}
          onChange={(value: string[]) => { setRoots(value); record('roots-change', value) }}
          browse={browse}
        />
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <XDriveActionButton compact onClick={() => record('compact-action')}>停止</XDriveActionButton>
            <XDriveActionButton onClick={() => record('normal-action')}>保存</XDriveActionButton>
            <XDriveActionButton compact disabled onClick={() => record('disabled-action')}>禁用按钮</XDriveActionButton>
            <XDriveActionButton compact loading loadingLabel="正在处理…" onClick={() => record('loading-action')}>加载按钮</XDriveActionButton>
          </Stack>
          <XDriveSourceSummaryCard
            name={longName}
            modeLabel="Synology File Station"
            statusTone="good"
            statusLabel="已就绪"
            activity="上次同步：2026-10-09"
            stats="20 项"
            actions={(
              <>
                <XDriveActionButton compact onClick={() => record('source-view')}>查看</XDriveActionButton>
                <XDriveActionButton compact onClick={() => record('source-settings')}>设置</XDriveActionButton>
              </>
            )}
          />
        </Stack>
      )}
    </Box>
  )
}

createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
