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
      if ((id === 96 || id === 141) && check.file === 'j') {
        // Keep all four historical native Simulator shards in the original
        // order. Permit only the stricter fifth candidate-mapkit shard, not
        // an arbitrary rearrangement or an omitted no-Session test.
        assert.equal(check.pattern,
          'source: \\[release-c83, candidate-navigation, candidate-gallery-files, candidate-no-session\\]')
        assert.match(source,
          /source:\s*\[release-c83,\s*candidate-navigation,\s*candidate-gallery-files,\s*candidate-no-session(?:,\s*candidate-mapkit)?\s*\]/,
          'historical '+id+' requires all original native UI shards')
        assert.match(source,
          /candidate-no-session\)[\s\S]*?XDriveIOSFilesSessionRecoveryUITests/,
          'the real no-Session native child remains a mandatory shard')
        if (source.includes('candidate-mapkit')) {
          assert.match(source,
            /candidate-mapkit\)[\s\S]*?XDriveIOSMapNavigationRuntimeUITests/,
            'candidate MapKit must really run the native UI suite')
          assert.match(source,
            /continue-on-error:\s*\$\{\{\s*matrix\.source == 'release-c83'\s*\}\}/,
            'new MapKit must fail on errors; only the old baseline can be optional')
        }
      } else {
        assert.match(source, new RegExp(check.pattern, check.flags || ''),
          'historical '+id+' fails on '+historical.sources[check.file])
      }
    }
  })
}
