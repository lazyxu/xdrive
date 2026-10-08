const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const manifest = JSON.parse(
  fs.readFileSync(path.join(repo, 'assets', 'icon', 'web', 'site.webmanifest'), 'utf8'),
)
const index = fs.readFileSync(path.join(repo, 'web', 'index.html'), 'utf8')

test('Web app manifest has a stable install identity and root navigation scope', () => {
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.lang, 'zh-CN')
  assert.equal(manifest.orientation, 'any')
  assert.equal(manifest.description, 'xDrive 网页文件管理器')
})

test('manifest keeps install icons and remains linked by the Web shell', () => {
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'))
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'))
  assert.ok(index.includes('<link rel="manifest" href="/site.webmanifest" />'))
  assert.ok(index.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />'))
})
