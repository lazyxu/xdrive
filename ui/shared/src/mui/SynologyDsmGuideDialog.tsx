import { useEffect, useMemo, useState } from 'react'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  Paper,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material'
import type { ExternalSource, SynologyDsmGuideVisual } from '../index'
import { synologyDsmSetupGuide } from '../index'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

const visuals: Record<SynologyDsmGuideVisual, string> = {
  'task-create': new URL('../../assets/synology-dsm-task-create.svg', import.meta.url).href,
  'task-schedule': new URL('../../assets/synology-dsm-task-schedule.svg', import.meta.url).href,
  'task-script': new URL('../../assets/synology-dsm-task-script.svg', import.meta.url).href,
}

export function XDriveSynologyDsmGuideDialog({
  open,
  source,
  serverURL,
  username,
  onClose,
}: {
  open: boolean
  source: ExternalSource | null
  serverURL?: string
  username?: string
  onClose: () => void
}) {
  const [activeStep, setActiveStep] = useState(0)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    if (open) {
      setActiveStep(0)
      setCopied('')
    }
  }, [open, source?.id])

  const guide = useMemo(() => {
    if (!source) return null
    return synologyDsmSetupGuide({
      sourceID: source.id,
      sourceName: source.name,
      serverURL,
      xdriveUsername: username,
    })
  }, [source, serverURL, username])

  const copy = async (id: string, command: string) => {
    await navigator.clipboard.writeText(command)
    setCopied(id)
    window.setTimeout(() => setCopied((value) => value === id ? '' : value), 1800)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle
        title={guide?.title ?? '群晖 DSM 配置'}
        subtitle={guide?.subtitle}
        onClose={onClose}
      />
      <DialogContent dividers sx={{ px: 2.5, py: 2.25 }}>
        {guide && (
          <Stack spacing={2.5}>
            <Alert severity="info">
              {guide.subtitle}。这些图片是 DSM 操作示意图，不同 DSM 版本的布局可能略有差异。
            </Alert>
            <Stepper activeStep={activeStep} orientation="vertical">
              {guide.steps.map((step, index) => (
                <Step key={step.id}>
                  <StepLabel>{step.title}</StepLabel>
                  <StepContent>
                    <Stack spacing={1.5} sx={{ pb: 1 }}>
                      <Typography variant="body2">{step.summary}</Typography>
                      {step.details?.map((detail) => (
                        <Typography key={detail} variant="body2" color="text.secondary">
                          • {detail}
                        </Typography>
                      ))}
                      {step.visual && (
                        <Box>
                          <Box
                            component="img"
                            src={visuals[step.visual]}
                            alt={step.title + ' DSM 操作示意图'}
                            sx={{
                              display: 'block',
                              width: '100%',
                              borderRadius: 2,
                              border: '1px solid',
                              borderColor: 'divider',
                              bgcolor: 'background.default',
                            }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            DSM 操作示意图
                          </Typography>
                        </Box>
                      )}
                      {step.command && (
                        <Paper
                          variant="outlined"
                          sx={{
                            position: 'relative',
                            p: 2,
                            pr: 12,
                            bgcolor: 'grey.950',
                            color: 'grey.100',
                            overflow: 'auto',
                          }}
                        >
                          <Typography
                            component="pre"
                            sx={{
                              m: 0,
                              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                              fontSize: 13,
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {step.command}
                          </Typography>
                          <Box sx={{ position: 'absolute', top: 10, right: 10 }}>
                            <XDriveActionButton
                              intent="primary"
                              startIcon={<ContentCopyRoundedIcon />}
                              onClick={() => void copy(step.id, step.command!)}
                              compact
                            >
                              {copied === step.id ? '已复制' : '复制'}
                            </XDriveActionButton>
                          </Box>
                        </Paper>
                      )}
                      <Stack direction="row" spacing={1}>
                        <XDriveActionButton
                          compact
                          disabled={index === 0}
                          onClick={() => setActiveStep((value) => Math.max(0, value - 1))}
                        >
                          上一步
                        </XDriveActionButton>
                        {index < guide.steps.length - 1 ? (
                          <XDriveActionButton compact intent="primary" onClick={() => setActiveStep(index + 1)}>
                            下一步
                          </XDriveActionButton>
                        ) : (
                          <XDriveActionButton compact intent="primary" onClick={onClose}>
                            完成
                          </XDriveActionButton>
                        )}
                      </Stack>
                    </Stack>
                  </StepContent>
                </Step>
              ))}
            </Stepper>
          </Stack>
        )}
      </DialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
