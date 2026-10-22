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
for (const item of cases) {
  test('P071 immutable native 100k benchmark parity: ' + item.name, () => {
    const old = read(item.source)
    const outputName = old.match(/^\s{10}name: (gallery-[^\n]+)$/m)
    assert.ok(outputName, 'Original immutable artifact name missing: ' + item.source)
    let expected = old.replace(/^name:.*$/m, 'name: ' + item.name)
    expected = expected.replace(/^    if:.*$/m, '    if: github.head_ref == \'' + branch + '\'')
    expected = expected.replace(outputName[0], '          name: ' + item.artifact)
    assert.equal(read(item.target), expected, 'Real PostgreSQL/CAS fixture, n3, physical SHA, budgets, sample gates and source checkout must remain exact')
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
