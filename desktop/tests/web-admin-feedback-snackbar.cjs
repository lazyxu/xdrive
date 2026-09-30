const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const adminUsers = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'AdminUsers.tsx'), 'utf8')

test('Web AdminUsers reuses shared feedback snackbar', () => {
  assert.ok(adminUsers.includes('XDriveFeedbackSnackbar'), 'AdminUsers should consume the shared feedback snackbar')
  assert.ok(adminUsers.includes('autoHideDuration={3000}'), 'AdminUsers feedback duration should remain unchanged')
  assert.ok(adminUsers.includes('<XDriveConfirmDialog'), 'AdminUsers should preserve the shared confirmation flow')
  assert.equal(adminUsers.includes('<Snackbar'), false, 'AdminUsers should not render a raw Snackbar')
  assert.equal(
    /import\s*\{[^}]*\bSnackbar\b[^}]*\}\s*from '@mui\/material'/s.test(adminUsers),
    false,
    'AdminUsers should not import MUI Snackbar directly',
  )
})
