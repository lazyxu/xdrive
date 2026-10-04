const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const externalSources = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const sharedFeedback = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FeedbackSnackbar.tsx'), 'utf8')

test('Web ExternalSources reuses shared feedback snackbar', () => {
  assert.ok(externalSources.includes('XDriveFeedbackSnackbar'), 'ExternalSources should consume the shared feedback snackbar')
  assert.ok(externalSources.includes('tone="good"'), 'ExternalSources success feedback tone should remain good')
  assert.equal(externalSources.includes('<Snackbar'), false, 'ExternalSources should not render a raw Snackbar')
  assert.equal(
    /import\s*\{[^}]*\bSnackbar\b[^}]*\}\s*from '@mui\/material'/s.test(externalSources),
    false,
    'ExternalSources should not import MUI Snackbar directly',
  )
  assert.ok(sharedFeedback.includes("autoHideDuration = 3500"), 'shared feedback snackbar should preserve the former ExternalSources duration by default')
})
