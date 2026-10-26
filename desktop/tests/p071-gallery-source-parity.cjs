'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const branch = 'perf/p071-gallery-100k-current-20261022'
const cases = [
  {
    "source": ".github/workflows/gallery-web-physical-mixed-100k-viewports.yml",
    "target": ".github/workflows/p071-gallery-wide-mixed-100k.yml",
    "name": "P071 Current 100k Gallery Wide 1440px Mixed CAS",
    "artifact": "p071-gallery-wide-mixed-115k-n3"
  },
  {
    "source": ".github/workflows/gallery-web-physical-mobile-100k-viewports.yml",
    "target": ".github/workflows/p071-gallery-mobile-mixed-100k.yml",
    "name": "P071 Current 100k Gallery Mobile 390px Mixed CAS",
    "artifact": "p071-gallery-mobile-mixed-115k-n3"
  },
  {
    "source": ".github/workflows/gallery-web-real-h264-posters-100k.yml",
    "target": ".github/workflows/p071-gallery-web-h264-posters-100k.yml",
    "name": "P071 Current 100k Gallery Web Genuine H264 Posters",
    "artifact": "p071-gallery-web-h264-100k-n3"
  }
]
function eventPaths(yaml, file) {
  const block = yaml.match(/^    paths:\n((?:      - '[^']+'\n)+)/m)
  assert(block, file + ' must have a narrow event-level PR path scope')
  return [...block[1].matchAll(/^      - '([^']+)'$/gm)].map(match => match[1])
}

// P071 freezes the actual PostgreSQL/CAS fixture, run budget and evidence
// contract. Event-level PR scoping is intentionally independent of that
// immutable runtime: different clients can need additional narrow paths.
function withoutPrPathScope(yaml, file) {
  const prefix = /^    # Limit branch-specific evidence to its dedicated source\/fixture paths\.\n    paths:\n(?:      - '[^']+'\n)+/m
  assert(prefix.test(yaml), file + ' is missing its audited path-only trigger')
  return yaml.replace(prefix, '')
}

for (const item of cases) {
  test('P071 immutable native 100k benchmark parity: ' + item.name, () => {
    const old = read(item.source)
    const outputName = old.match(/^\s{10}name: (gallery-[^\n]+)$/m)
    assert.ok(outputName, 'Original immutable artifact name missing: ' + item.source)
    let expected = old.replace(/^name:.*$/m, 'name: ' + item.name)
    expected = expected.replace(/^    if:.*$/m, '    if: github.head_ref == \'' + branch + '\'')
    expected = expected.replace(outputName[0], '          name: ' + item.artifact)
    const target = read(item.target)
    const targetPaths = eventPaths(target, item.target)
    for (const required of eventPaths(old, item.source)) {
      assert(targetPaths.includes(required), item.target + ' must keep related native source trigger: ' + required)
    }
    assert.equal(withoutPrPathScope(target, item.target), withoutPrPathScope(expected, item.source),
      'Real PostgreSQL/CAS fixture, n3, physical SHA, budgets, sample gates and source checkout must remain exact outside PR path scope')
    for (const must of [
      'ref: $' + '{{ github.event.pull_request.head.sha }}',
      'image: postgres:17-alpine',
      'go test -c',
      'xvfb-run -a',
      "test \"$(find \"$XD_",
      'retention-days: 14',
    ]) assert.ok(expected.includes(must), 'Missing frozen original acceptance: ' + must)
    assert.ok(expected.includes("if: github.head_ref == '" + branch + "'"))
  })
}
