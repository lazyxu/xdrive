'use strict'
/** Restored, source-pinned historical xDrive Gallery/Files contracts from the
 * divergent 2026-11-09 #4205 development branch. Source assertions only:
 * simulator timing/FPS and signed real iPhone UI are NOT established.
 * The complete 184-case archive stays in docs/ci, while only cases proven
 * against the reviewed master are executable here. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const historical = require('../../docs/ci/ios-gallery-files-4205-historical-scenarios.json')
const accepted = historical.revalidated_on_snapshot
const cache = new Map()
const readSource = key => {
  const name = historical.sources[key]
  assert.ok(typeof name === 'string' && !name.includes('..'),
    'historical source key must be a scoped repository path: '+key)
  if (!cache.has(name))
    cache.set(name, fs.readFileSync(path.join(root, name), 'utf8'))
  return cache.get(name)
}
test('4205 source-historical archive preserves all 184 original scenarios and exact IDs', () => {
  assert.equal(historical.source_commit, 'fb3b6e22df05390cb7ec76b926a7ee3fb937758e')
  assert.equal(historical.scenarios.length, 184)
  assert.equal(accepted.length, 58)
  assert.equal(new Set(accepted).size, accepted.length)
  assert.ok(!accepted.includes(125), 'retired no-Session retry control must not be reintroduced')
})
for (const id of accepted) {
  const item = historical.scenarios[id - 1]
  test('4205 restored source regression: '+item.name, () => {
    assert.ok(item.name.startsWith(String(id)+' '),
      'historical case identity must not drift')
    for (const check of item.checks) {
      const source = readSource(check.file)
      // The archive records the exact 2026-11-09 matrix, but current iOS
      // routing adds independent candidate suites (e.g. candidate-mapkit).
      // Preserve the four original mandatory arms AND forbid duplicate
      // entries; do not mistake additional real tests for a regression.
      if ((id === 96 || id === 141) && check.file === 'j') {
        const matrix = [...source.matchAll(/^\\s*source:\\s*\\[([^\\]\\r\\n]+)\\]\\s*$/gm)]
        assert.equal(matrix.length, 1, 'exactly one native Simulator source matrix')
        const arms = matrix[0][1].split(',').map(name => name.trim())
        const required = [
          'release-c83', 'candidate-navigation',
          'candidate-gallery-files', 'candidate-no-session',
        ]
        assert.deepEqual(arms.slice(0, required.length), required,
          'all legacy candidate gates and real release baseline are mandatory')
        assert.equal(new Set(arms).size, arms.length,
          'native Simulator source matrix may not contain duplicate suites')
        assert.ok(arms.every(name => /^[a-z][a-z0-9-]*$/.test(name)),
          'native Simulator matrix admits only bounded named sources')
        continue
      }
      assert.match(source, new RegExp(check.pattern, check.flags || ''),
        'historical '+id+' fails on '+historical.sources[check.file])
    }
  })
}
