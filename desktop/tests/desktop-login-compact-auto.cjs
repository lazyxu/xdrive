const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/App.tsx'), 'utf8')
const main = fs.readFileSync(path.join(__dirname, '../src/main/index.cts'), 'utf8')
const lan = fs.readFileSync(path.join(__dirname, '../src/main/lan_root_auto.cts'), 'utf8')

test('Desktop login only exposes Server and optional LAN address; all routing stays automatic', () => {
  assert.ok(renderer.includes('label="服务器"'))
  assert.ok(renderer.includes('label="内网 IP（可选）"'))
  assert.ok(renderer.includes("connection_route: { mode: 'auto', lan_ip: connectionRoute.lan_ip, public_ip: '' }"))
  assert.equal(renderer.includes('label="连接模式"'), false)
  assert.equal(renderer.includes('label="公网 IP（可选，留空使用 DNS）"'), false)
  assert.equal(renderer.includes('撤销此服务器信任'), false)
  assert.equal(renderer.includes('根证书 SHA-256'), false)
})

test('First-time private HTTPS identity approval remains available without permanent certificate panel', () => {
  assert.ok(renderer.includes('验证此服务器'))
  assert.ok(renderer.includes('window.xdriveDesktop.trustLANServer(selected)'))
  assert.ok(main.includes('inspectPrivateLANFirstUse'))
  assert.ok(main.includes('probeWithTrustedLANRoot'))
  assert.ok(lan.includes('tls.checkServerIdentity'))
})

test('Temporary network failure does not turn off automatic login', () => {
  assert.ok(main.includes('credentialsMustBeReentered'))
  assert.ok(main.includes('status === 401 || status === 403'))
  assert.ok(main.includes("const route: ConnectionRoute = { mode: 'auto', lan_ip: previousRoute.lan_ip, public_ip: '' }"))
})
