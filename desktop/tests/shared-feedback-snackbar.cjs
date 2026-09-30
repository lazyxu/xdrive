const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const feedback = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FeedbackSnackbar.tsx'), 'utf8')
const statusAlert = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'StatusAlert.tsx'), 'utf8')
const webApp = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const desktopApp = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')

test('Web feedback uses the shared snackbar surface', () => {
  assert.ok(feedback.includes('export function XDriveFeedbackSnackbar'), 'shared feedback snackbar is missing')
  assert.ok(feedback.includes('<Snackbar'), 'shared feedback snackbar must own the MUI Snackbar')
  assert.ok(feedback.includes('<XDriveStatusAlert'), 'shared feedback snackbar must use the shared status alert')
  assert.ok(feedback.includes("reason !== 'clickaway'"), 'shared feedback snackbar must ignore clickaway close events')
  assert.ok(feedback.includes("vertical: 'bottom', horizontal: 'right'"), 'shared feedback snackbar anchor contract drifted')
  assert.ok(feedback.includes('autoHideDuration = 3500'), 'shared feedback snackbar default timeout drifted')
  assert.ok(statusAlert.includes("variant = 'standard'"), 'shared status alert must support alert variants')
  assert.ok(statusAlert.includes('onClose?: () => void'), 'shared status alert must support dismissible feedback')
  assert.equal((webApp.match(/<XDriveFeedbackSnackbar/g) || []).length, 2, 'both Web feedback surfaces must use the shared snackbar')
  assert.equal(webApp.includes('<Snackbar'), false, 'Web must not render raw MUI Snackbar directly')
})


test('Desktop feedback uses the shared snackbar surface', () => {
  assert.equal((desktopApp.match(/<XDriveFeedbackSnackbar/g) || []).length, 1, 'Desktop must use one shared feedback snackbar')
  assert.equal(desktopApp.includes('<Snackbar'), false, 'Desktop must not render raw MUI Snackbar directly')
  assert.equal(desktopApp.includes('<MuiAlert'), false, 'Desktop must not render raw MUI Alert directly')
  assert.ok(desktopApp.includes("tone={error ? 'bad' : 'good'}"), 'Desktop feedback tone mapping drifted')
  assert.ok(desktopApp.includes('autoHideDuration={error ? null : 4000}'), 'Desktop feedback timeout mapping drifted')
  assert.ok(desktopApp.includes('variant="filled"'), 'Desktop feedback should keep the filled alert treatment')
  assert.ok(desktopApp.includes('dismissible'), 'Desktop feedback should remain dismissible')
})
