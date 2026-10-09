const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('Caddy image smoke test drains module listing under pipefail', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'),
    'utf8',
  )
  assert.match(workflow, /set -euo pipefail/)
  assert.match(workflow, /docker run --rm xdrive\/caddy:test caddy list-modules \| grep -Fx 'dns\.providers\.alidns' >\/dev\/null/)
  assert.doesNotMatch(workflow, /docker run --rm xdrive\/caddy:test caddy list-modules \| grep -q/)
})
