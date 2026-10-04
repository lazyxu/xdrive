const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop auth headings use MUI Typography instead of global heading CSS', () => {
  assert.equal((app.match(/component="h1"/g) || []).length, 3, 'all Desktop auth titles should use MUI Typography h1 semantics')
  assert.equal((app.match(/variant="overline"/g) || []).length, 2, 'Agent and forced-password states should keep eyebrow semantics')
  assert.ok(app.includes("letterSpacing: '0.14em'"), 'auth eyebrow tracking should stay explicit in MUI')
  assert.ok(app.includes("fontSize: 27"), 'auth title size should remain stable')
  assert.ok(app.includes("maxWidth: 500"), 'auth subtitle width should remain constrained')
  assert.ok(app.includes("lineHeight: 1.6"), 'auth subtitle line height should remain readable')

  for (const legacy of [
    'className="eyebrow"',
    'className="subtitle"',
    '<h1>',
  ]) {
    assert.equal(app.includes(legacy), false, `legacy auth typography remains: ${legacy}`)
  }

  for (const selector of [
    '.auth-panel h1',
    '.auth-panel .subtitle',
    '.eyebrow',
    'h1 {',
    '.subtitle {',
  ]) {
    assert.equal(styles.includes(selector), false, `legacy auth typography CSS remains: ${selector}`)
  }
})
