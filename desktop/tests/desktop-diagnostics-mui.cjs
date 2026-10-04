const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const page = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopDiagnosticsPage.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop diagnostics uses MUI layout instead of legacy diagnostic CSS', () => {
  for (const token of [
    "import { Box, Paper, Stack, Typography } from '@mui/material'",
    '<Stack spacing={2.5}>',
    '<XDriveMetricGrid>',
    'direction="row"',
    'useFlexGap',
    'flexWrap="wrap"',
    '<Paper',
    'variant="outlined"',
    "gridTemplateColumns: '54px minmax(0, 1fr)'",
    '<XDriveStatusBadge',
    'variant="body2"',
    'variant="caption"',
  ]) {
    assert.ok(page.includes(token), `Desktop diagnostics MUI layout missing: ${token}`)
  }

  for (const legacy of [
    'className="diagnostics-panel"',
    'className="diagnostic-actions"',
    'className="diagnostic-list"',
    'className="diagnostic-row"',
  ]) {
    assert.equal(page.includes(legacy), false, `legacy diagnostics wrapper remains: ${legacy}`)
  }

  for (const selector of [
    '.diagnostics-panel {',
    '.diagnostic-actions {',
    '.diagnostic-list {',
    '.diagnostic-row {',
    '.diagnostic-row strong',
    '.diagnostic-row p',
  ]) {
    assert.equal(styles.includes(selector), false, `legacy diagnostics CSS remains: ${selector}`)
  }
})
