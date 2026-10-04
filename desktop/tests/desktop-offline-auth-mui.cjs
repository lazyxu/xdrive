const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop disconnected Agent state uses MUI layout instead of offline legacy CSS', () => {
  for (const token of [
    '<MuiBox',
    "bgcolor: 'action.hover'",
    "overflowWrap: 'anywhere'",
    "direction={{ xs: 'column', sm: 'row' }}",
    "'& > *': { flex: 1 }",
    '<Typography variant="caption"',
    'textAlign="center"',
    '正在等待桌面 IPC 连接…',
    '启动 / 重启 Agent',
  ]) {
    assert.ok(app.includes(token), `Desktop offline MUI layout missing: ${token}`)
  }

  for (const legacy of [
    'className="offline-box"',
    'className="offline-actions"',
    'className="footnote"',
  ]) {
    assert.equal(app.includes(legacy), false, `legacy offline class remains: ${legacy}`)
  }

  for (const selector of ['.offline-box', '.offline-actions', '.footnote']) {
    assert.equal(styles.includes(selector), false, `legacy offline CSS remains: ${selector}`)
  }

  assert.ok(app.includes('<XDriveAuthShell>'), 'Desktop disconnected state must keep shared auth shell')
  assert.ok(app.includes('<XDriveAuthPanel className="auth-panel">'), 'Desktop disconnected state must keep shared auth panel')
})
