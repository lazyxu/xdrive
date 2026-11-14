'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8')

const map = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const wall = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const cluster = read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const ui = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')
const scope = read('ios/XDriveIOS/NativePhotoOwnerScope.swift')
const ownerRoot = /origin == expected\.origin[\s\S]*?instanceID == expected\.instanceID[\s\S]*?ownerID == expected\.ownerID[\s\S]*?username == expected\.username[\s\S]*?rootNodeID == expected\.rootNodeID/

test('P0 A/B: same canonical GPS place cannot be opened after Owner changed', () => {
  assert.match(scope, ownerRoot)
  assert.match(map, /private struct XDriveIOSOwnerMapChosenPlace: Identifiable \{[\s\S]*?let id: String[\s\S]*?let owner: XDriveNativeOwnerRoot/)
  assert.match(map, /selected = XDriveIOSOwnerMapChosenPlace\(id: item\.id, owner: expected\)/)
  assert.match(map, /selected = XDriveIOSOwnerMapChosenPlace\(id: facet\.id, owner: expected\)/)
  const sheet = map.slice(map.indexOf('.sheet(item: $selected, onDismiss:'), map.indexOf('.sheet(item: $selectedCluster, onDismiss:'))
  assert.match(sheet, /if XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, place\.owner\)[\s\S]*?phase == \.active/)
  assert.match(sheet, /XDriveIOSNativeServerMediaWall\([\s\S]*?placeID: place\.id/)
  assert.match(sheet, /native-ios-owner-map-place-revoked/)
})

test('P0 A/B: still-mounted cloud Range and thumbnails are hidden synchronously at render', () => {
  const visual = wall.slice(wall.indexOf('func visiblePage(for currentOwner:'), wall.indexOf('func invalidate()'))
  assert.match(visual, /let page, let pageScope, let currentReader/)
  assert.match(visual, /XDriveIOSNativePhotoOwnerScope\.matches\(currentOwner, pageScope\)/)
  assert.match(visual, /XDriveIOSNativePhotoOwnerScope\.matches\(currentReader\.owner, pageScope\)/)
  const virtual = wall.slice(wall.indexOf('private struct XDriveIOSNativeServerVirtualRange:'), wall.indexOf('struct XDriveIOSNativeServerMediaWall:'))
  assert.match(virtual, /if let verified = model\.visiblePage\(for: login\.owner\)/)
  assert.match(virtual, /guard !pending, let page = model\.visiblePage\(for: login\.owner\)/)
  const parent = wall.slice(wall.indexOf('struct XDriveIOSNativeServerMediaWall:'))
  assert.match(parent, /if let page = model\.visiblePage\(for: login\.owner\)/)
})

test('P0 A/B: a reused numeric Owner ID cannot keep a prior server virtual-range task', () => {
  const virtual = wall.slice(wall.indexOf('private struct XDriveIOSNativeServerVirtualRange:'), wall.indexOf('struct XDriveIOSNativeServerMediaWall:'))
  assert.match(virtual, /private var ownerTaskScope: String \{[\s\S]*?owner\.origin\.absoluteString[\s\S]*?owner\.instanceID[\s\S]*?owner\.ownerID[\s\S]*?owner\.username[\s\S]*?owner\.rootNodeID/)
  assert.match(virtual, /\.task\(id: "[^\n]+\\\(ownerTaskScope\)[^\n]+"/)
  assert.doesNotMatch(virtual, /\.task\(id: "[^\n]+\\\(login\.owner\?\.ownerID \?\? 0\)/)
})

test('P0 401/403 + delayed Owner A auth: old response cannot invalidate or publish B page', () => {
  const fn = wall.slice(wall.indexOf('func load(login: '), wall.indexOf('func thumbnail(_ item:', wall.indexOf('func load(login: ')))
  const auth = fn.indexOf('auth = try await login.verifiedAuthorization()')
  const fence = fn.indexOf('guard self?.epoch == ticket,', auth)
  const mismatch = fn.indexOf('self?.invalidate()', fence)
  const read = fn.indexOf('let result = try await reader.page(', fence)
  const publish = fn.indexOf('self?.page = result', read)
  assert.ok(auth >= 0 && fence > auth && mismatch > fence && read > fence && publish > read)
  assert.match(fn.slice(fence, mismatch), /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(fn.slice(read, publish), /self\?\.epoch == ticket[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(fn, /guard self\?\.epoch == ticket,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)[\s\S]*?canRetainPage\(after: error\)/)
  assert.match(fn, /case \.response\(let status\):[\s\S]*?permitsRetainingPreviousPage/)
})

test('P0 Owner map: old cover/overview and stale 401/403 cannot re-enter after revocation', () => {
  assert.match(map, /displayedOverviewMatchesLogin \? overview : nil/)
  assert.match(map, /displayedOverviewMatchesLogin \? coverImages : \[:\]/)
  assert.match(map, /guard !Task\.isCancelled, epoch == ticket,[\s\S]*?login\.owner, expected[\s\S]*?group\.cancelAll\(\); return/)
  assert.match(map, /case \.revoked:[\s\S]*?group\.cancelAll\(\)[\s\S]*?invalidate\(\)/)
  const reload = map.slice(map.indexOf('private func reload() {'))
  assert.match(reload, /epoch = UUID\(\)[\s\S]*?reader\.mapOverview\([\s\S]*?Task\.checkCancellation\(\)[\s\S]*?epoch == ticket[\s\S]*?matches\(login\.owner, expected\)/)
})

test('P0 late pagination: only same signed Node+revision set may keep cover pixels after L3', () => {
  assert.match(cluster, /if target == departingCursor, let departingPage, activeOwner[\s\S]*?coverImages = coverImages\.filter/)
  assert.match(cluster, /departingPage\.sameVisibleSnapshot\(as: fetched\), activeOwner[\s\S]*?coverImages = coverImages\.filter/)
  assert.match(cluster, /case \.response\(let status\) where status == 401 \|\| status == 403:[\s\S]*?invalidate\(\)/)
  assert.match(cluster, /case \.invalidScope, \.invalidPage, \.malformed,[\s\S]*?invalidate\(\)/)
  assert.match(cluster, /guard !Task\.isCancelled, generation == ticket,[\s\S]*?activeOwner, cursor == target,[\s\S]*?page\?\.sameVisibleSnapshot\(as: fetched\) == true/)
  assert.match(cluster, /\.accessibilityIdentifier\("native-ios-owner-map-cluster-tile-\\\(item\.id\)-\\\(item\.node\.revision\)"\)/)
})

test('P0 rapid Viewer return does not re-center an unchanged authorized item', () => {
  assert.match(local, /if viewerOpeningID != id \{\s*scroll\.scrollTo\(id, anchor: \.center\)/)
  assert.match(local, /viewerOpeningID = item\.id[\s\S]*?viewerReturnID = item\.id/)
  assert.match(cluster, /viewerOpeningItem = item[\s\S]*?viewerReturn = item/)
  assert.match(cluster, /viewerOpeningItem\.map\(\{[\s\S]*?!\$0\.sameVisibleRevision\(as: anchor\)[\s\S]*?\}\) \?\? true \{\s*returnScroll\.scrollTo/)
  assert.match(local, /\.accessibilityValue\("return-anchor-\\\(item\.id\.hashValue\)"\)/)
  assert.match(ui, /testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted\(\)/)
  assert.match(ui, /XCTAssertEqual\(tile\.value as\? String, stableID/)
  assert.match(ui, /XCTAssertLessThanOrEqual\(abs\(tile\.frame\.midY - beforeBackFrame\.midY\), 12/)
  assert.match(ui, /IOS_NATIVE_NAV_TAP_START route=native-ios-map-viewer-back/)
})
