const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const shared = fs.readFileSync(path.join(__dirname, '../../ui/shared/src/mui/SensitiveField.tsx'), 'utf8')
const panel = fs.readFileSync(path.join(__dirname, '../../ui/shared/src/mui/CaddyAliDNSPanel.tsx'), 'utf8')

test('retained credentials show an input mask without modifying the editable draft', () => {
  assert.match(shared, /configuredLength\?: number/)
  assert.match(shared, /const retained = configured && !value && !editing/)
  assert.match(shared, /\*'\.repeat\(maskLength\)/)
  assert.match(shared, /const shownValue = value \|\|/)
  assert.match(shared, /onChange\(event\.target\.value\)/)
  assert.doesNotMatch(shared, /onChange\(shownValue\)/)
})

test('focus starts a blank replacement draft and blur restores retained mask', () => {
  assert.match(shared, /if \(configured && !value && !visible\) setEditing\(true\)/)
  assert.match(shared, /onBlur=\{\(\) => setEditing\(false\)\}/)
  assert.match(shared, /visible \? revealedValue : retained/)
})

test('AliDNS retains stored values and uses the shared field for both keys', () => {
  assert.equal((panel.match(/<XDriveSensitiveField\b/g) || []).length, 2)
  assert.match(panel, /configured=\{config\.configured\}/)
  assert.match(panel, /access_key_id: keyID, access_key_secret: keySecret/)
})
