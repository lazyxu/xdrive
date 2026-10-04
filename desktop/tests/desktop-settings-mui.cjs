const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const page = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopSettingsContent.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop settings form uses MUI fields and layout instead of legacy form CSS', () => {
  for (const token of [
    'Divider,',
    'InputAdornment,',
    'TextField,',
    '<MuiBox component="form"',
    '<TextField',
    'slotProps={{',
    '<InputAdornment position="end">GiB</InputAdornment>',
    '<Divider />',
    'justifyContent="space-between"',
    'useFlexGap',
    'loadingLabel="正在保存…"',
  ]) {
    assert.ok(page.includes(token), `Desktop settings MUI form missing: ${token}`)
  }

  for (const legacy of [
    'className="settings-form"',
    'className="input-action"',
    'className="input-with-unit"',
    'className="settings-divider"',
    'className="setting-link-row"',
    'className="form-actions"',
  ]) {
    assert.equal(page.includes(legacy), false, `legacy Desktop settings class remains: ${legacy}`)
  }

  for (const selector of [
    '.settings-form',
    '.input-action',
    '.input-with-unit',
    '.settings-divider',
    '.setting-link-row',
    '.form-actions',
  ]) {
    assert.equal(styles.includes(selector), false, `legacy Desktop settings CSS remains: ${selector}`)
  }

  assert.ok(styles.includes('.update-card {'), 'client-update styling must remain untouched')
  assert.ok(styles.includes('.offline-actions {'), 'offline action styling must remain untouched')
})
