const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const shareDialog = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'ShareDialog.tsx'), 'utf8')
const sharedFeedback = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FeedbackSnackbar.tsx'), 'utf8')

test('Web ShareDialog reuses shared feedback snackbar', () => {
  assert.ok(shareDialog.includes('XDriveFeedbackSnackbar'), 'ShareDialog should consume the shared feedback snackbar')
  assert.ok(shareDialog.includes('autoHideDuration={3000}'), 'ShareDialog feedback duration should remain unchanged')
  assert.equal(shareDialog.includes('<Snackbar'), false, 'ShareDialog should not render a raw Snackbar')
  assert.equal(
    /import\s*\{[^}]*\bSnackbar\b[^}]*\}\s*from '@mui\/material'/s.test(shareDialog),
    false,
    'ShareDialog should not import MUI Snackbar directly',
  )
  assert.ok(sharedFeedback.includes("anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}"), 'shared feedback snackbar should own the common placement')
  assert.ok(sharedFeedback.includes("reason !== 'clickaway'"), 'shared feedback snackbar should own clickaway handling')
})
