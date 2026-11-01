'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const view = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const exports = read('ios/XDriveIOS/NativeFilesDownloadExport.swift')

test('native Files uses system Quick Look on one verified already-downloaded private file', () => {
  assert.match(view, /import QuickLook/)
  assert.match(view, /@State private var quickLookURL: URL\?/)
  assert.match(view, /if let prepared = exporter\.prepared,[\s\S]*?prepared\.nodeID == entry\.node\.id,[\s\S]*?prepared\.revision == entry\.node\.revision/)
  assert.match(view, /quickLookURL = prepared\.fileURL/)
  assert.match(view, /Button\("完成"\) \{ selectedFile = nil \}[\s\S]*?\.quickLookPreview\(\$quickLookURL\)\s*\}\s*\}\s*\.onAppear/);
  assert.match(view, /Label\("原生只读预览", systemImage: "eye"\)/)
  assert.match(view, /原生预览须先下载到临时目录/)
  assert.doesNotMatch(view, /WKWebView|UIWebView|PDFDocument\(|fileExporter\(/)
})
test('Viewer dismissal and Owner/tab change retire pending Quick Look before private download file cleanup', () => {
  assert.match(view, /\.sheet\(item: \$selectedFile, onDismiss: \{\s*quickLookURL = nil\s*exporter\.invalidate\(\)/)
  assert.match(view, /\.onDisappear \{\s*quickLookURL = nil\s*exporter\.invalidate\(\)/)
  assert.match(view, /selectedFile = nil\s*offset = 0\s*model\.invalidate\(\)\s*quickLookURL = nil\s*exporter\.invalidate\(\)/)
  assert.match(exports, /prepared\?\.discard\(\)/)
  assert.match(exports, /FileProtectionType\.complete/)
  assert.match(exports, /stillCurrent == node/)
})
