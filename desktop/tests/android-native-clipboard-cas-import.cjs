'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const ctrl = read('android/app/src/main/java/com/tfluid/xdrive/DriveController.kt')
const ui = read('android/app/src/main/java/com/tfluid/xdrive/NativeClipboardScreens.kt')

test('Android native SAF file picker never silently submits Clipboard message', () => {
  assert.match(ui, /rememberLauncherForActivityResult\(/)
  assert.match(ui, /ActivityResultContracts\.OpenDocument\(\)/)
  assert.match(ui, /stillSession\(intent\.first\)/)
  assert.match(ui, /pickerIntent = Triple\(actionFence\.capture\(\), targetID, referenceKind\)/)
  assert.match(ui, /controller\.clipboardImportLocalFile\(context, uri\)/)
  assert.match(ui, /referenceNodeID = result\.id\.toString\(\)/)
  assert.match(ui, /再次点击定向加密发送/)
  assert.match(ui, /if \(referenceKind != pair\.first\) \{\s*referenceKind = pair\.first\s*referenceNodeID = ""/)
  assert.doesNotMatch(ui.slice(ui.indexOf('val localFilePicker ='), ui.indexOf('Column(Modifier.fillMaxSize')),
    /clipboardCreateDirected\(/)
})

test('Android Clipboard reuses original Owner Files UploadSession with private immutable staging', () => {
  assert.match(ctrl, /NativePhotoOriginalStager\.stage\(context\.cacheDir, size\)/)
  assert.match(ctrl, /original\.verifyBeforeWrite\(\)/)
  assert.match(ctrl, /service\.uploadFile\(token, root, name, original\.bytes/)
  assert.match(ctrl, /uploaded\.parentId == root\.id/)
  assert.match(ctrl, /service\.nodeLocation\(token, uploaded\.id\)/)
  assert.match(ctrl, /located\.parentId == root\.id/)
  assert.match(ctrl, /located\.revision >= uploaded\.revision/)
  assert.match(ctrl, /currentClipboardSession\(\)/)
  const importBody = ctrl.slice(ctrl.indexOf('suspend fun clipboardImportLocalFile('),
    ctrl.indexOf('suspend fun clipboardDevices()'))
  assert.doesNotMatch(importBody, /uploadManagedAndroidPhotoOriginal\\s*\\(|uploadNativePhotoOriginal\\s*\\(|sourceRun\\s*\\(/)
})

test('Android Owner A-B-A, Lock, stale target and unknown ACK never auto-retry or broadcast', () => {
  assert.match(ui, /pendingDirected = DirectedClipboardPending/)
  assert.match(ui, /previous\.deviceID != target/)
  assert.match(ui, /previous\.kind != kind \|\| previous\.nodeID != node/)
  assert.match(ui, /pendingDirected\?\.wire != wire/)
  assert.match(ui, /pendingDirected == null\)\{Text\("加密发送"\)/)
  assert.match(ui, /val \(snapshot, selectedTarget, selectedKind\) = intent/)
  assert.match(ui, /targetID == selectedTarget && referenceKind == selectedKind/)
  assert.match(ui, /if \(stillSession\(snapshot\)\) busy = false/)
})
