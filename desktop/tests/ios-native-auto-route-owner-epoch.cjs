'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeAutoNetworkRoute.swift'), 'utf8')
const safety = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeAutoRouteSafety.swift'), 'utf8')

test('network handoff refuses credential transfer to an unproven LAN or cell path', () => {
  assert.match(safety, /static func preferredOrigin\(/)
  assert.match(safety, /if onLocalNetwork, let lan, proven\.contains\(lan\.absoluteString\)/)
  assert.match(safety, /if proven\.contains\(domain\.absoluteString\)/)
  assert.match(source, /let canUseLAN = epoch == 0 \? state\.active == state\.lan : local/)
  assert.match(source, /XDriveIOSAutoRouteSafety\.preferredOrigin\(/)
  assert.doesNotMatch(source.slice(source.indexOf('func selectedRoute(for original:'),source.indexOf('func selectedURL(for original:')), /preferred = state\.active/)
})

test('in-flight HTTP and SSE callbacks fail closed on logout, Owner replacement and token rotation', () => {
  assert.match(source, /func isCurrentRoute\(_ id: UUID, request: URLRequest\) -> Bool/)
  assert.match(source, /guard let current = binding, current\.id == id,/)
  assert.match(source, /expectedRouteID = route\.id/)
  assert.match(source, /let old = handle[\s\S]*?old\?\.cancel\(\)/)
  assert.match(source, /client\?\.urlProtocol\(self, didFailWithError: URLError\(\.cancelled\)\)/)
  for (const name of ['receive(_ response: URLResponse)', 'receive(_ bytes: Data)', 'completed(_ failure: Error?)']) {
    const from = source.indexOf('fileprivate func ' + name)
    assert.ok(from > 0, 'missing ' + name)
    assert.match(source.slice(from, from+240), /guard routeIsCurrent\(\) else \{ retireStaleRoute\(\); return \}/)
  }
  assert.match(source, /func clear\(\) \{[\s\S]*?binding = nil/)
  assert.match(source, /func isCurrentRoute\(_ id: UUID, request: URLRequest\)/)
  assert.match(source, /presentedGrant = request\.value\([\s\S]*?"X-XDrive-IOS-Photo-Grant"/)
  assert.match(source, /approved\.grantSecret == presentedGrant/)
  assert.match(source, /approved\.matches\(owner\)/)
  assert.match(source, /backgroundGrant: grant/)
  assert.match(source, /backgroundGrant: nil/)
  assert.match(source, /XDriveIOSApprovedPhotoBGVault\.prove\(/)

})
