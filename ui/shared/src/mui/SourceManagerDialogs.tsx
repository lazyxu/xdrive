import {
  Box as MuiBox,
  Dialog,
  DialogContentText,
  Stack,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveSourceFailureItem } from './SourceFailureItem'
import { XDriveStatusAlert } from './StatusAlert'
import { formatSize } from '../format'
import type { ExternalSourceItem } from '../external-sources'

export type XDriveSourceErrorDialogState = {
  title: string
  message: string
  detail?: string
}

export function XDriveSourceFailedItemsDialog({
  open,
  items,
  limitReached,
  onClose,
}: {
  open: boolean
  items: ExternalSourceItem[]
  limitReached: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open={open && items.length > 0}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title="失败文件" onClose={onClose} />
      <XDriveDialogContent dividers>
        {limitReached ? (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            当前最多显示前 1000 个失败项。
          </XDriveStatusAlert>
        ) : null}
        <Stack spacing={1.5}>
          {items.map((item) => (
            <XDriveSourceFailureItem
              key={item.source_item_id}
              title={item.path || item.external_id}
              externalID={item.external_id}
              sizeLabel={formatSize(item.size)}
              error={item.last_error}
            />
          ))}
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}

export function XDriveSourceDeleteConfirmDialog({
  open,
  sourceName,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  sourceName: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title="删除同步文件夹？" onClose={onClose} closeDisabled={busy} />
      <XDriveDialogContent>
        <DialogContentText>
          删除“{sourceName}”只会移除同步配置、运行记录、同步文件夹映射和已保存凭据。
          已经同步到 xDrive 的文件会保留，不会删除。
        </DialogContentText>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton disabled={busy} onClick={onClose}>取消</XDriveActionButton>
        <XDriveActionButton
          intent="danger"
          disabled={busy}
          loading={busy}
          loadingLabel="正在删除…"
          onClick={onConfirm}
        >
          删除同步文件夹
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}

export function XDriveSourceClearCredentialDialog({
  open,
  credentialLabel,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  credentialLabel: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle
        title={`清除已保存的${credentialLabel}？`}
        onClose={onClose}
        closeDisabled={busy}
      />
      <XDriveDialogContent>
        <DialogContentText>
          清除后，该 Pull 同步文件夹会自动暂停，无法继续扫描或同步，直到重新配置有效凭据。
        </DialogContentText>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton disabled={busy} onClick={onClose}>取消</XDriveActionButton>
        <XDriveActionButton
          intent="danger"
          disabled={busy}
          loading={busy}
          loadingLabel="正在清除…"
          onClick={onConfirm}
        >
          清除凭据
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}

export function XDriveSourceErrorDialog({
  state,
  onClose,
}: {
  state: XDriveSourceErrorDialogState | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={Boolean(state)}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title={state?.title ?? '操作失败'} onClose={onClose} />
      <XDriveDialogContent dividers>
        {state ? (
          <Stack spacing={1.5}>
            <XDriveStatusAlert tone="bad">{state.message}</XDriveStatusAlert>
            {state.detail ? (
              <MuiBox>
                <MuiTypography variant="caption" color="text.secondary">详细信息</MuiTypography>
                <MuiTypography
                  variant="body2"
                  sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {state.detail}
                </MuiTypography>
              </MuiBox>
            ) : null}
          </Stack>
        ) : null}
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton intent="primary" onClick={onClose}>知道了</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
