import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import {
  xDriveFileExplorerActionFeedback,
  type XDriveFileExplorerActionFeedbackValue,
} from '../file-operations'

export type XDriveFileExplorerActionFeedbackProps = {
  value: XDriveFileExplorerActionFeedbackValue | null
  onViewTask?: (operationID: string) => void
  onDismiss: () => void
}

/** The owning App supplies its current operation or actual download outcome. */
export function XDriveFileExplorerActionFeedback({
  value,
  onViewTask,
  onDismiss,
}: XDriveFileExplorerActionFeedbackProps) {
  if (!value) return null
  const feedback = xDriveFileExplorerActionFeedback(value)
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
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
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
