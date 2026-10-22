'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const fs=require('node:fs')
const {pathToFileURL}=require('node:url')
const repo=path.resolve(__dirname,'../..')
const where=p=>path.join(repo,p)
const childDir='deploy/baidu-isolated-child/'
const script=where(childDir+'validate-site.mjs')
const common=fs.readFileSync(where('deploy/Caddyfile.common'),'utf8')
const compose=fs.readFileSync(where('deploy/docker-compose.yml'),'utf8')
const regular=fs.readFileSync(where('deploy/Caddyfile'),'utf8')

test('standalone Caddy child is opt-in and cannot turn existing Gallery into same-Origin child',()=>{
  const policy=fs.readFileSync(where(childDir+'Caddyfile.example'),'utf8')
  assert(!common.includes('xdrive_baidu_isolated'),'main Gallery Caddy is untouched')
  assert(!compose.includes('XD_BAIDU_ISOLATED_CHILD_HOST'),'no implicit child startup')
  assert(!regular.includes('XD_BAIDU_ISOLATED_CHILD_HOST'),'no accidental virtual host')
  assert.match(policy,/frame-ancestors \{\$XD_BAIDU_GALLERY_ORIGIN\}/)
  assert.match(policy,/connect-src 'self'/)
  assert.match(policy,/Permissions-Policy/)
  assert.match(policy,/handle\s*\{\s*respond 404/)
  assert.match(policy,/handle \/_BMapService\/\*/)
  assert.match(policy,/handle \/_xdrive_baidu_isolated\/session/)
  assert.doesNotMatch(policy,/file_server browse|handle \/api/)
})

test('optional host validator refuses same cookie site, HTTP, ports, IPs, placeholders and sibling domains',async()=>{
  const {validateIndependentBaiduSites:v}=await import(pathToFileURL(script).href)
  assert.equal(v('https://gallery.example.net','https://map-isolated.example.org'),true)
  for(const [parent,child] of [
    ['http://gallery.example.net','https://map.example.org'],
    ['https://gallery.example.net','https://map.example.net'],
    ['https://gallery.example.net','https://gallery.example.net:8443'],
    ['https://gallery.example.net','https://map.deep.example.net'],
    ['https://127.0.0.1','https://map.example.org'],
    ['https://gallery.localhost','https://map.example.org'],
    ['https://gallery.example.net','https://map.other.test'],
    ['https://gallery.example.net','https://user:pass@other.example.org'],
    ['https://gallery.example.net','https://map.example.org/path'],
    ['https://gallery.example.net','https://map.example.org?key=secret'],
  ]) assert.equal(v(parent,child),false,parent+' '+child)
})

test('real hostile Chrome runner verifies delayed top navigation and uses deployed child CSP source',()=>{
  const browser=fs.readFileSync(where('desktop/scripts/baidu-isolated-child-chromium.cjs'),'utf8')
  assert.doesNotMatch(browser,/proof\.navigation\s*=\s*top\s*!==\s*window/,
    'top !== window is tautological in any iframe, not a navigation proof')
  assert.match(browser,/navigationAttempted/)
  assert.match(browser,/await new Promise\(resolve=>setTimeout\(resolve,750\)\)/)
  assert.match(browser,/confirmed\?\.pathname,'\/','sandbox allowed a top-level navigation'/)
  assert.match(browser,/read\('Caddyfile\.example'\)/,
    'actual child CSP must be the one represented by the Caddy source')
  assert.match(browser,/privateReads===0&&childCookies===0/)
})
