const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repo, 'web', 'src', 'styles.css'), 'utf8')

test('shared SourceManager owns list spacing without Web-only legacy CSS', () => {
  assert.ok(sourceManager.includes('<Stack spacing={1.75}>'), 'shared SourceManager should own the 14px list gap')
  assert.equal(sourceManager.includes('className="external-source-list"'), false, 'shared SourceManager must not depend on Web list CSS')

  for (const selector of [
    '.external-source-list',
    '.external-source-card-header',
    '.external-source-card-meta',
    '.external-source-subtitle',
    '.external-source-time',
    '.external-source-stats',
    '.external-source-empty',
    '.external-source-actions',
  ]) {
    assert.equal(webStyles.includes(selector), false, `Web must not retain legacy Source CSS: ${selector}`)
  }
})
