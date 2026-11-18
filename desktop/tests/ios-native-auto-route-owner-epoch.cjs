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
  assert.match(source, /func isCurrentRoute\(_ id: UUID, request: URLRequest,/)
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
  assert.match(source, /physicalURL: URL, lanEvidenceEpoch: UInt64\) -> Bool/)
  assert.match(source, /presentedGrant = request\.value\([\s\S]*?"X-XDrive-IOS-Photo-Grant"/)
  assert.match(source, /approved\.grantSecret == presentedGrant/)
  assert.match(source, /approved\.matches\(owner\)/)
  assert.match(source, /backgroundGrant: grant/)
  assert.match(source, /backgroundGrant: nil/)
  assert.match(source, /XDriveIOSApprovedPhotoBGVault\.prove\(/)
  const bgTask = fs.readFileSync(path.resolve(__dirname, '../..',
    'ios/XDriveIOS/BackgroundPhotoTask.swift'), 'utf8')
  const vault = fs.readFileSync(path.resolve(__dirname, '../..',
    'ios/XDriveIOS/ApprovedBackgroundPhotoVault.swift'), 'utf8')
  assert.match(bgTask, /XDriveIOSAutoRoute\.shared\s*\.prepareBackground\(savedGrant\)/)
  assert.match(bgTask, /XDriveIOSApprovedPhotoBGVault\.prove\(\s*savedGrant, at: route\.selected, direct: true\)/)
  assert.ok(bgTask.indexOf('XDriveIOSApprovedPhotoBGVault.prove(') <
    bgTask.indexOf('XDriveIOSAutoRoute.shared.activateBackground('),
    'independently prove the BG grant before route activation')
  assert.doesNotMatch(bgTask.slice(
    bgTask.indexOf('let savedGrant ='), bgTask.indexOf('let owner = try approved.ownerScope()')
  ), /\.proveInBackground\(\)/, 'never verify the pre-activation grant through the router')
  assert.match(vault, /proof\.server_instance_id == item\.instanceID/)
  assert.match(vault, /proof\.owner_id == item\.ownerID/)
  assert.match(vault, /proof\.device_id == item\.deviceID/)
  assert.match(vault, /proof\.source_id == item\.sourceID/)
  assert.match(vault, /proof\.target_node_id == item\.targetNodeID/)
  assert.match(vault, /completionHandler\(nil\)/)
  assert.match(source, /approved\.grantSecret == presentedGrant/)


})

test('old LAN frames cannot publish after a Wi-Fi/cellular handoff or route recovery', () => {
  assert.match(safety, /static func mayDeliverFromRoute\(/)
  assert.match(safety, /admittedLANEpoch == currentLANEpoch/)
  assert.match(source, /var lanEvidenceEpoch: UInt64/)
  assert.equal((source.match(/current\.lanEvidenceEpoch &\+= 1/g) || []).length, 2,
    'both network changes and failed-LAN recoveries retire old LAN leases')
  assert.match(source, /return \(routed, state\.id, state\.lanEvidenceEpoch\)/)
  assert.match(source, /expectedLANEpoch = route\.lanEvidenceEpoch/)
  assert.match(source, /routeIsCurrent\(physical: target\)/)
  assert.match(source, /XDriveIOSAutoRouteSafety\.mayDeliverFromRoute\(/)
  assert.match(source, /matching\(physicalURL, binding: current\)/)
  assert.match(source, /lanProofPresent: current\.lan\.map/)
  assert.match(source, /currentLANEpoch: current\.lanEvidenceEpoch/)
})
