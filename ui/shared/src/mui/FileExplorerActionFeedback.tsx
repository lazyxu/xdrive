import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import {
  xDriveFileExplorerActionFeedback,
  type XDriveFileExplorerActionFeedbackValue,
} from '../file-operations'

export type XDriveFileExplorerActionFeedbackProps = {
  value: XDriveFileExplorerActionFeedbackValue | null
  onViewTask?: (operationID: string) => void
  onRetryTask?: (operationID: string) => void
  onUndoTask?: (operationID: string) => void
  actionsBusy?: boolean
  onDismiss: () => void
}

/** The owning App supplies its current operation or actual download outcome. */
export function XDriveFileExplorerActionFeedback({
  value,
  onViewTask,
  onRetryTask,
  onUndoTask,
  actionsBusy = false,
  onDismiss,
}: XDriveFileExplorerActionFeedbackProps) {
  if (!value) return null
  const feedback = xDriveFileExplorerActionFeedback(value)
  const operation = value.kind === 'operation' ? value.operation : null
  const retryID = operation?.status === 'failed' && operation.retryable ? operation.id : null
  const undoID = operation?.status === 'completed' && operation.undoable ? operation.id : null
  const severity = feedback.tone === 'good' ? 'success'
    : feedback.tone === 'warning' ? 'warning'
      : feedback.tone === 'bad' ? 'error' : 'info'
  const buttonSx = { minHeight: 44, minWidth: 44, flexShrink: 0 }

  return (
    <Alert
      data-xdrive-file-explorer-action-feedback
      severity={severity}
      icon={false}
      role={feedback.tone === 'bad' ? 'alert' : 'status'}
      aria-atomic="true"
      sx={{
        mx: 1.25,
        my: 0.75,
        minWidth: 0,
        flexShrink: 0,
        '& .MuiAlert-message': { minWidth: 0, width: '100%', p: 0 },
      }}
    >
      <Stack spacing={0.75}>
        <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {feedback.message}
        </Typography>
        {feedback.details.length > 0 ? (
          <Box
            role="group"
            aria-label="操作详情"
            tabIndex={0}
            sx={{ minWidth: 0, maxHeight: 'min(24dvh, 160px)', overflowY: 'auto', overflowWrap: 'anywhere' }}
          >
            <Stack spacing={0.5}>
              {feedback.details.map((row, index) => (
                <Typography key={index} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  <Box component="span" fontWeight={600}>{row.label}：</Box>{row.value}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
        {actionsBusy && ((retryID && onRetryTask) || (undoID && onUndoTask)) ? (
          <Typography variant="caption" color="text.secondary" role="status">
            正在处理其他文件操作，暂不可重复提交。
          </Typography>
        ) : null}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {retryID && onRetryTask ? (
            <Button
              size="small"
              variant="outlined"
              sx={buttonSx}
              disabled={actionsBusy}
              onClick={() => onRetryTask(retryID)}
            >
              重试
            </Button>
          ) : null}
          {undoID && onUndoTask ? (
            <Button
              size="small"
              variant="outlined"
              sx={buttonSx}
              disabled={actionsBusy}
              onClick={() => onUndoTask(undoID)}
            >
              撤销
            </Button>
          ) : null}
          {feedback.operationID && onViewTask ? (
            <Button
              size="small"
              variant="outlined"
              sx={buttonSx}
              onClick={() => onViewTask(feedback.operationID!)}
            >
              查看任务
            </Button>
          ) : null}
          <Button size="small" sx={buttonSx} onClick={onDismiss}>关闭提示</Button>
        </Stack>
      </Stack>
    </Alert>
  )
}
