import { useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material'
import { yikeCookieHelp } from '../index'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

function CookieHelpContent({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <Typography variant="body2">{yikeCookieHelp.summary}</Typography>
      <ol style={{ margin: compact ? '10px 0' : '12px 0', paddingLeft: 24 }}>
        {yikeCookieHelp.steps.map((step) => (
          <li key={step}>
            <Typography variant="body2" sx={{ mb: compact ? 0 : 0.75 }}>{step}</Typography>
          </li>
        ))}
      </ol>
      <Alert severity="warning">{yikeCookieHelp.security}</Alert>
    </>
  )
}

export function XDriveYikeCookieHelp({
  variant,
}: {
  variant: 'accordion' | 'dialog'
}) {
  const [open, setOpen] = useState(false)

  if (variant === 'accordion') {
    return (
      <Accordion
        disableGutters
        elevation={0}
        sx={{
          mt: 1,
          border: 1,
          borderColor: 'divider',
          borderRadius: '8px !important',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{yikeCookieHelp.title}</Typography>
            <Typography variant="caption" color="text.secondary">点击展开</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <CookieHelpContent compact />
        </AccordionDetails>
      </Accordion>
    )
  }

  return (
    <>
      <Button
        type="button"
        size="small"
        variant="text"
        onClick={() => setOpen(true)}
        sx={{ alignSelf: 'flex-start', minWidth: 0, px: 0.5, mt: 0.25, textTransform: 'none' }}
      >
        如何获取 Cookie？
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title={yikeCookieHelp.title} onClose={() => setOpen(false)} />
        <DialogContent dividers sx={{ px: 2.5, py: 2.25 }}>
          <CookieHelpContent />
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25, minHeight: 58, bgcolor: 'action.hover' }}>
          <Button onClick={() => setOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
