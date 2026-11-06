'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativeFilesManagementPanel.swift'),
  'utf8'
)

test('native Files exposes tag management for the exact file and folder', () => {
  assert.match(source, /Section\("标签"\)[\s\S]*?XDriveIOSNativeFilesTagPanel\(/)
  assert.match(source, /nodeIDs: \[file\.id\]/)
  assert.match(source, /nodeIDs: \[directory\.id\]/)
  assert.match(source, /\.accessibilityIdentifier\("native-ios-files-manage-tags"\)/)
  assert.match(source, /\.accessibilityIdentifier\("native-ios-files-manage-folder-tags"\)/)
  assert.match(source, /private struct XDriveIOSNativeFilesTagPanel: View/)
})

test('native tag transport is HTTPS, non-redirecting and cookie-free', () => {
  assert.match(source, /components\.scheme == "https"/)
  assert.match(source, /origin == owner\.origin/)
  assert.match(source, /completionHandler\(nil\)/)
  assert.match(source, /URLSessionConfiguration\.ephemeral/)
  assert.match(source, /config\.httpShouldSetCookies = false/)
  assert.match(source, /request\.httpShouldHandleCookies = false/)
  assert.match(source, /"Bearer " \+ accessToken/)
  assert.match(source, /accepted\.contains\(http\.statusCode\)/)
  assert.match(source, /data\.count <= 2_097_152/)
})

test('tag mutations use bounded Owner node IDs and verified Server routes', () => {
  assert.match(source, /nodeIDs\.count <= 500/)
  assert.match(source, /Set\(nodeIDs\)\.count == nodeIDs\.count/)
  assert.match(source, /perform\("\/api\/v1\/file-tags", accepted: \[200\]\)/)
  assert.match(source, /perform\("\/api\/v1\/nodes\/tags\/query"/)
  assert.match(source, /perform\("\/api\/v1\/file-tags\/\\\(tagID\)\/nodes"/)
  assert.match(source, /let method = assigned \? "PUT" : "DELETE"/)
  assert.match(source, /rows\.count == nodeIDs\.count, Set\(rowIDs\) == Set\(nodeIDs\)/)
})

test('tag model re-verifies Owner and fences stale asynchronous work', () => {
  assert.match(source, /login\.verifiedAuthorization\(\)/)
  assert.match(source, /XDriveIOSNativePhotoOwnerScope\.matches\(credentials\.owner, expectedOwner\)/)
  assert.match(source, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/)
  assert.match(source, /guard epoch == ticket/)
  assert.match(source, /try await verify\(ticket: ticket\)/)
  assert.match(source, /task\?\.cancel\(\)/)
  assert.match(source, /\.onDisappear \{ model\.invalidate\(\) \}/)
})

test('tag deletion requires explicit confirmation; unknown writes are not retried blindly', () => {
  assert.match(source, /\.alert\("删除标签", isPresented: \$showingDeleteConfirmation\)/)
  assert.match(source, /Button\("删除", role: \.destructive\)/)
  assert.match(source, /status = "标签操作结果未确认，请刷新核对后再继续。"/)
  assert.match(source, /操作结果未确认；请刷新核对，不要直接重复操作。/)
  assert.match(source, /\.accessibilityIdentifier\("native-ios-files-tag-management"\)/)
})
