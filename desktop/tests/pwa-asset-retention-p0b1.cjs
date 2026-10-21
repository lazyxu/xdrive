'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const archiveTool = path.join(root, 'deploy/pwa-archive-assets.sh')
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-assets-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const source = path.join(dir, 'image'), archive = path.join(dir, 'archive')
  fs.mkdirSync(source)
  fs.mkdirSync(archive)
  return { source, archive }
}
function write(dir, name, bytes) {
  const p = path.join(dir, name)
  fs.mkdirSync(path.dirname(p), {recursive:true})
  fs.writeFileSync(p, bytes)
}
function seed(a, b) { return spawnSync('sh', [archiveTool, a, b], {encoding:'utf8'}) }

test('P0B1 real shell: old lazy JS survives two image upgrades and rollback', t => {
  if (process.platform === 'win32') return t.skip('POSIX Caddy only')
  const {source,archive} = fixture(t)
  write(source, 'index-abcdefgh.js', 'old entry')
  write(source, 'viewer-abcdef12.js', 'old lazy')
  assert.equal(seed(source,archive).status, 0)
  fs.rmSync(source,{recursive:true,force:true}); fs.mkdirSync(source)
  write(source,'index-zzzz1234.js','new entry')
  write(source,'viewer-123456ab.js','new lazy')
  assert.equal(seed(source,archive).status, 0)
  assert.equal(seed(source,archive).status, 0)
  for(const [name,contents] of [['viewer-abcdef12.js','old lazy'],['index-abcdefgh.js','old entry'],
      ['viewer-123456ab.js','new lazy'],['index-zzzz1234.js','new entry']])
    assert.equal(fs.readFileSync(path.join(archive,name),'utf8'),contents)
})

test('P0B1 real shell: content collision and private/unversioned names fail closed', t => {
  if (process.platform === 'win32') return t.skip('POSIX Caddy only')
  const {source,archive} = fixture(t)
  write(source,'viewer-abcdef12.js','original')
  assert.equal(seed(source,archive).status,0)
  write(source,'viewer-abcdef12.js','tampered')
  assert.notEqual(seed(source,archive).status,0)
  assert.equal(fs.readFileSync(path.join(archive,'viewer-abcdef12.js'),'utf8'),'original')
  fs.rmSync(path.join(source,'viewer-abcdef12.js'))
  write(source,'api/user.json','private')
  assert.notEqual(seed(source,archive).status,0)
  assert.equal(fs.existsSync(path.join(archive,'api')),false)
})

test('P0B1: main Caddy-only mount, source archive, pre-upgrade import and immutable HTTP', () => {
  const compose=read('deploy/docker-compose.yml')
  const dockerfile=read('deploy/Caddy.Dockerfile')
  const launcher=read('deploy/caddy-lan-start.sh')
  const installer=read('deploy/install-server.sh')
  const route=read('deploy/Caddyfile.common')
  assert.ok(compose.includes('${XD_CADDY_ASSET_DIR:-../data/caddy/assets}:/srv/assets'))
  const normal=compose.split('\n  caddy:\n')[1].split('\n  caddy-rescue:\n')[0]
  assert.ok(normal.includes(':/srv/assets'))
  assert.ok(!compose.split('\n  caddy-rescue:\n')[1].includes(':/srv/assets'))
  assert.ok(dockerfile.includes('COPY web/dist/assets/ /usr/share/xdrive-current-assets/'))
  assert.ok(dockerfile.includes('COPY deploy/pwa-archive-assets.sh /usr/local/bin/xdrive-pwa-archive-assets'))
  assert.ok(launcher.indexOf('if [ "${1:-}" = "--check" ]') < launcher.indexOf('/usr/local/bin/xdrive-pwa-archive-assets '))
  assert.ok(launcher.indexOf('/usr/local/bin/xdrive-pwa-archive-assets ') < launcher.indexOf('exec caddy run'))
  assert.ok(installer.includes('configure_data_path XD_CADDY_ASSET_DIR "$DATA_DIR/caddy/assets"'))
  assert.ok(installer.includes('docker cp "$old_id:/srv/assets/." "$staging/"'))
  assert.ok(installer.indexOf('  preserve_current_caddy_assets\n') < installer.indexOf('stage 6 "install deployment files"'))
  assert.ok(route.includes('handle /assets/* {'))
  assert.ok(route.includes('public, max-age=31536000, immutable'))
})
