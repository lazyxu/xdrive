'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '../..')
const active = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const archived = fs.readFileSync(
  path.join(root, 'docs/history/AGENTS-2026-10-27-before-consolidation.md')
)
const historicalBlob = createHash('sha1')
  .update(Buffer.from('blob ' + archived.byteLength + '\0', 'utf8'))
  .update(archived)
  .digest('hex')

test('2026-10-27 AGENTS archive is byte-identical and the old test contracts remain auditable', () => {
  assert.equal(historicalBlob, '59649587795cda139e2b53ecc7de0642e93ae3f8')
  const old = archived.toString('utf8')
  for (const marker of [
    'P101 verified tree disclosure without height animation (mandatory)',
    '## P103 · Mobile Gallery detail Back must wait for verified first photo Range',
    '## P109 · Transient Mobile Files feedback must not resize scroll owner',
    'Mandatory tested-workload registry and deduplication',
    'Permanent photo-map no-extra-consent policy'
  ]) assert.ok(old.includes(marker), 'original archive is missing: ' + marker)
})

test('the active policy remains concise and enforces real user decisions', () => {
  assert.ok(active.length > 2000 && active.length < 16000)
  assert.ok(active.split('\n').length < 150)
  for (const required of [
    'GitHub master is canonical',
    'A newer master SHA does not invalidate a green PR by itself',
    'actual GitHub-required checks',
    'Every change, including `AGENTS.md` and CI workflows',
    'Never push directly to `master`',
    'complete build/testing/publishing contracts',
    'Never claim skipped checks passed',
    '跳过（未验收）',
    'docs/performance-test-registry.md',
    'ui/shared',
    'full-screen iOS 27 Files/Gallery',
    'Every authenticated Owner-visible asset with current valid GPS',
    'never bypass protection',
    'No duplicate NAS uploader',
    'Do not weaken assertions',
  ]) {
    assert.ok(active.includes(required), 'active rule missing: ' + required)
  }
  assert.ok(!active.includes('P101 verified tree disclosure without height animation (mandatory)'),
    'historical PR evidence must not bloat the active policy again')
})
