'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
const dockerfile=read('deploy/Caddy.Dockerfile')
const workflow=read('.github/workflows/ci.yml')
const release=read('.github/workflows/release.yml')
const gallery=read('deploy/Caddyfile.common')
const childConfig=read('deploy/baidu-isolated-child/Caddyfile.example')
const child=read('deploy/baidu-isolated-child/child.js')
const html=read('deploy/baidu-isolated-child/index.html')
const docs=read('deploy/baidu-isolated-child/README.md')

test('the exact optional Child files are packaged OUTSIDE Gallery /srv',()=>{
  for(const name of ['index.html','child.js','child.css']){
    const from='deploy/baidu-isolated-child/'+name
    const target='/usr/share/xdrive-baidu-isolated-child/'+name
    assert.ok(fs.statSync(path.join(root,from)).size>0)
    assert.ok(dockerfile.includes('COPY '+from+' '+target),name)
    assert.doesNotMatch(dockerfile,
      new RegExp('COPY deploy/baidu-isolated-child/'+name.replace('.','\\.')+
        ' /srv/'), 'never copy Child into Gallery static root')
  }
  assert.ok(!gallery.includes('xdrive-baidu-isolated-child'))
  assert.ok(!gallery.includes('_xdrive_baidu_isolated'))
  assert.match(gallery,/root \* \/srv/)
})

test('the actual Caddy image build must match all shipped Child source bytes',()=>{
  const start=workflow.indexOf('  caddy-image:')
  const end=workflow.indexOf('\n  ',start+3)
  const build=workflow.slice(start,end>start?end:undefined)
  assert.ok(build.includes('docker build --build-arg'))
  assert.match(build,/for asset in index\.html child\.js child\.css; do/)
  assert.match(build,/sha256sum "deploy\/baidu-isolated-child\/\$asset"/)
  assert.match(build,/sha256sum "\/usr\/share\/xdrive-baidu-isolated-child\/\$asset"/)
  assert.match(build,/\[\[ "\$actual" == "\$expected" \]\]/)
  assert.match(build,/test ! -e \/srv\/xdrive-baidu-isolated-child\/child\.js/)
  assert.match(build,/test ! -e \/srv\/_xdrive_baidu_isolated\/child\.js/)
  // Published GHCR Caddy must derive from the CI-verified image archive,
  // never a separate unchecked rebuild or a service that exposes the Child.
  assert.match(release,/load_exact xdrive-caddy-image xdrive\/caddy:test/)
  assert.match(release,/docker push "\$remote"/)
  assert.doesNotMatch(release,/docker\/build-push-action/)
})

test('packaged independent Child remains unconfigured until a trusted Origin is verified',()=>{
  assert.match(html,/REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN/)
  assert.match(childConfig,/NOT imported by deploy\/Caddyfile or docker-compose/)
  assert.match(childConfig,/frame-ancestors \{\$XD_BAIDU_GALLERY_ORIGIN\}/)
  assert.match(childConfig,/uri strip_prefix \/_xdrive_baidu_isolated/)
  assert.match(childConfig,/root \* \/srv\/xdrive-baidu-isolated-child/)
  assert.match(childConfig,/handle \{\s*respond 404\s*\}/)
  assert.match(docs,/not automatic isolated-Child deployment/)
  assert.match(docs,/Updating only the Server/)
  assert.match(docs,/validate-site\.mjs/)
  assert.match(child,/let heldMousePointer = null, viewportAfterMouseRelease = false/)
  assert.match(child,/if \(heldMousePointer !== null\)/)
  assert.match(child,/releaseMousePointer\(\)/)
  assert.doesNotMatch(child,/\.node_id\b|\.asset_id\b|photo_url|Authorization:/)
})
