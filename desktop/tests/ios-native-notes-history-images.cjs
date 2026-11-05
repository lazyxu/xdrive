const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const screen = read('ios/XDriveIOS/NativeNotesScreen.swift')
const client = read('ios/XDriveIOS/NativeNotesClient.swift')
const preview = read('ios/XDriveIOS/NativeNotesMarkdownPreview.swift')
const intent = read('ios/XDriveIOS/NativeAppleNotesImportIntent.swift')
const policy = read('ios/XDriveIOS/NativeAppleNotesImportPolicy.swift')

assert.match(screen,
  /XDriveIOSNativeNotesMarkdownPreview\(\s*login: login,\s*noteID: noteID,\s*markdown: oldMarkdown\s*\)/,
  'historical Markdown must use the same Owner-authorized inline-image renderer as current content')
assert.doesNotMatch(screen, /AttributedString\(markdown:\s*oldMarkdown\)/,
  'history must not silently downgrade image-bearing Markdown to text-only rendering')

assert.match(client, /func versions\(id: String\) async throws -> \[XDriveIOSNativeNoteVersion\]/)
assert.match(client, /func previousMarkdown\(nodeID: UInt64, versionID: UInt64\) async throws -> String/)
assert.match(client, /func readNoteImage\(noteID: String, relativePath: String\) async throws -> Data/)
assert.match(client, /func importIOSNoteImage\(noteID: String, bytes: Data\) async throws -> String/)

assert.match(preview, /login\.verifiedAuthorization\(\)/,
  'historical images must use the current verified Owner session')
assert.match(preview, /client\.readNoteImage\(\s*noteID: noteID, relativePath: path\s*\)/,
  'image reads must remain bound to the same Note')
assert.match(preview, /UIImage\(data: bytes\)/)

assert.match(intent, /var sourceIdentifier: String\?/)
assert.match(intent, /sourceIdentifier: sourceIdentifier/)
assert.match(policy, /externalID: id/,
  'the caller-provided stable key must be preserved; no title/date-derived identity')
assert.match(policy, /externalID\.isEmpty/,
  'missing stable identity must remain an independent snapshot')

console.log('iOS Notes history image readback and explicit Shortcut source identity: PASS')
