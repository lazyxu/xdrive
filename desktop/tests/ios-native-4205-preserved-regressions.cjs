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
      // #4205 case 184 archived an obsolete "if count < 3" two-tap limit.
      // The current route sampler intentionally observes taps 1, 2, 4, 8,
      // 12 and 16 during longer navigation journeys. Preserve the original
      // historical JSON unchanged; verify the stronger bounded, real-tap
      // replacement rather than reintroducing the old control flow.
      if (id === 184 && check.file === 'p' &&
          check.pattern === 'if count < 3:') {
        assert.match(source,
          /TAP_CAPTURE_NUMBERS = frozenset\(\(1, 2, 4, 8, 12, 16\)\)/)
        assert.match(source, /tap_counts\[current_case\] = count/)
        assert.match(source,
          /if \(minimal and count == 1\) or \(not minimal and count in TAP_CAPTURE_NUMBERS\):/)
        assert.match(source,
          /delays = \(0\.55,\) if minimal else TAP_FRAME_OFFSETS_SECONDS/)
        assert.match(source, /MAX_CAPTURE_LAG_SECONDS = 0\.75/)
        assert.match(source, /MAX_CAPTURE_DURATION_SECONDS = 2\.5/)
        assert.match(source, /report_missed\(key, missed_starts, missed_taps\)/)
        continue
      }
      assert.match(source, new RegExp(check.pattern, check.flags || ''),
        'historical '+id+' fails on '+historical.sources[check.file])
    }
  })
}
