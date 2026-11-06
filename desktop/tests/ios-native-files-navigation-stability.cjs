'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8')
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const tile = read('ios/XDriveIOS/NativeFilesThumbnail.swift')
const nav = read('ios/XDriveIOS/NativeFilesNavigationPolicy.swift')
const section = (start, end) => {
  const from = browser.indexOf(start)
  const to = browser.indexOf(end, from)
  assert.ok(from >= 0 && to > from, 'scoped section exists: ' + start)
  return browser.slice(from, to)
}

test('directory navigation never removes the source NavigationLink on push', () => {
  const model = section('@MainActor\nprivate final class XDriveIOSNativeFilesPageModel', '@MainActor\nprivate final class XDriveIOSNativeFilesSearchOptionsModel')
  const suspend = section('private func suspendVisibleRange()', 'var body: some View')
  assert.match(browser, /NavigationLink\(value: XDriveIOSNativeFilesFolder/)
  assert.match(browser, /\.navigationDestination\(for: XDriveIOSNativeFilesFolder\.self\)/)
  assert.match(suspend, /model\.suspendForNavigation\(\)/)
  assert.doesNotMatch(suspend, /model\.invalidate\(\)/)
  const suspendModel = model.slice(model.indexOf('func suspendForNavigation()'), model.indexOf('func cancelAdjacent()', model.indexOf('func suspendForNavigation()')))
  assert.match(suspendModel, /job\?\.cancel\(\)/)
  assert.match(suspendModel, /cancelAdjacent\(\)/)
  assert.doesNotMatch(suspendModel, /entries\s*=\s*\[\]|verifiedPage\s*=\s*false|invalidate\(\)/)
})

test('same verified Owner, folder, search and sort reuse parent rows after pop', () => {
  const onAppear = section('var body: some View', '.onDisappear { suspendVisibleRange() }')
  assert.match(onAppear, /model\.canResume\(/)
  assert.match(onAppear, /pendingNavigationReturnNodeID = nil/)
  assert.match(onAppear, /else \{\s*reload\(\)/)
  assert.doesNotMatch(onAppear, /\.onAppear \{\s*reload\(\)/)
  assert.match(browser, /XDriveIOSNativeFilesNavigationPolicy\.canResume\(/)
  assert.match(nav, /sameOwner && sameFolder && sameQuery/)
  assert.match(nav, /sameFilters && sameSort && sameOrder/)
})

test('Owner switch or explicit refresh really invalidates old page', () => {
  const changedOwner = section('.onChange(of: login.owner)', '.onChange(of: model.verifiedPage)')
  assert.match(changedOwner, /model\.invalidate\(\)/)
  assert.match(changedOwner, /clipboard\.clear\(\)/)
  const invalidate = section('    func invalidate() {', '    func load(login:')
  assert.match(invalidate, /verifiedOwner = nil/)
  assert.match(invalidate, /entries = \[\]/)
  assert.match(invalidate, /verifiedPage = false/)
  const reload = section('private func reload(resetOffset: Bool = false)', '\n}')
  assert.match(reload, /model\.load\(login: login/)
})

test('ordinary folder browse skips two unrelated source/tag reads', () => {
  const appear = section('.onAppear {', '.onDisappear { suspendVisibleRange() }')
  assert.match(appear, /if isGlobalSearch \{ searchOptions\.load\(login: login\) \}/)
  assert.match(browser, /Button\("加载同步文件夹与标签筛选"\)/)
  assert.match(browser, /searchOptions\.load\(login: login\)/)
})

test('thumbnail display is bound to the exact source revision and Owner', () => {
  assert.match(tile, /bitmapIdentity\.revision == identity\.revision/)
  assert.match(tile, /bitmapIdentity\.serverOrigin == identity\.serverOrigin/)
  assert.match(tile, /bitmapIdentity\.ownerID == identity\.ownerID/)
  assert.match(tile, /bitmapIdentity\.rootNodeID == identity\.rootNodeID/)
  assert.doesNotMatch(tile, /\.onDisappear \{ bitmap = nil \}/)
  assert.match(tile, /XDriveIOSNativeFilesThumbnailSlots\.shared\.perform/)
  assert.match(tile, /try Task\.checkCancellation\(\)/)
})

test('thumbnail sessions are cookie-free, non-redirecting, and shared without caching', () => {
  assert.equal((tile.match(/URLSession\(/g) || []).length, 1)
  assert.match(tile, /private static let session: URLSession/)
  assert.match(tile, /URLSessionConfiguration\.ephemeral/)
  assert.match(tile, /config\.httpShouldSetCookies = false/)
  assert.match(tile, /config\.urlCache = nil/)
  assert.match(tile, /completionHandler\(nil\)/)
  assert.match(tile, /Self\.session\.data\(for: request\)/)
})
