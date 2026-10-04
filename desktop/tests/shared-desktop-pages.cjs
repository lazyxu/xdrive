const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const overview = read('desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
const conflicts = read('desktop', 'src', 'renderer', 'DesktopConflictsPage.tsx')
const styles = read('desktop', 'src', 'renderer', 'styles.css')
const metrics = read('ui', 'shared', 'src', 'mui', 'MetricCards.tsx')

test('Desktop overview uses shared metric primitives instead of local status-card CSS', () => {
  assert.ok(metrics.includes('sx?: SxProps<Theme>'))
  assert.ok(metrics.includes('...(Array.isArray(sx) ? sx : sx ? [sx] : [])'))
  assert.ok(overview.includes('<XDriveMetricGrid sx={{ mt: 1.5 }}>'))
  assert.equal((overview.match(/<XDriveMetricCard\b/g) || []).length, 4)
  assert.ok(overview.includes('<Paper variant="outlined"'))
  for (const legacy of ['status-grid', 'status-card', 'status-dot', 'system-card']) {
    assert.equal(overview.includes(legacy), false)
    assert.equal(styles.includes(`.${legacy}`), false)
  }
})

test('Desktop conflicts uses standard MUI surfaces instead of bespoke conflict-row CSS', () => {
  for (const token of [
    "import { Box, Paper, Stack, Typography } from '@mui/material'",
    '<Stack spacing={1.25} sx={{ mt: 2.25 }}>',
    'variant="outlined"',
    "flexDirection: { xs: 'column', md: 'row' }",
    "overflowWrap: 'anywhere'",
    'useFlexGap',
  ]) assert.ok(conflicts.includes(token), `missing: ${token}`)
  for (const legacy of ['conflict-list', 'conflict-row', 'conflict-copy', 'row-actions']) {
    assert.equal(conflicts.includes(legacy), false)
    assert.equal(styles.includes(`.${legacy}`), false)
  }
  assert.ok(conflicts.includes('<XDriveStatePanel message="没有未解决的冲突。" />'))
})
