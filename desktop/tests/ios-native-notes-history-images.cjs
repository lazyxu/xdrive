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
assert.match(client, /func previousMarkdown\(nodeID: UInt64, version: XDriveIOSNativeNoteVersion\) async throws -> String/)
assert.match(client, /Int64\(data\.count\) == version\.bytes/)
assert.match(client, /digest == version\.sha256\.lowercased\(\)/)
assert.match(client, /response\.value\(forHTTPHeaderField: "ETag"\)/)
assert.match(client, /etag\?\.lowercased\(\) == digest/)
assert.match(client, /func readNoteImage\(noteID: String, relativePath: String\) async throws -> Data/)
assert.match(client, /func importIOSNoteImage\(noteID: String, bytes: Data\) async throws -> String/)

assert.match(preview, /login\.verifiedAuthorization\(\)/,
  'historical images must use the current verified Owner session')
assert.match(preview, /client\.readNoteImage\(\s*noteID: noteID, relativePath: relativePath\s*\)/,
  'image reads must remain bound to the same Note')
assert.match(preview, /UIImage\(data: bytes\)/)

assert.match(intent, /var sourceIdentifier: String\?/)
assert.match(intent, /sourceIdentifier: sourceIdentifier/)
assert.match(policy, /externalID: id/,
  'the caller-provided stable key must be preserved; no title/date-derived identity')
const policyTests = read('ios/tests/NativeAppleNotesImportPolicyChecks.swift')
assert.match(policy, /let id = \(externalID \?\? ""\)/)
assert.match(policyTests, /noIdentifier\.externalID\.isEmpty/,
  'missing stable identity must remain an independent snapshot')

// Keep history export in the existing verified Owner read transport on all
// supported presentation surfaces; this is a source contract, not device proof.
const sharedNotes = read('ui/shared/src/mui/NotesPage.tsx')
const nativeAndroid = read('android/app/src/main/java/com/tfluid/xdrive/NativeNotesScreens.kt')
assert.match(sharedNotes, /await port\.readVersion\(selected\.node_id, item\.id\)/)
assert.match(sharedNotes, /new Blob\(\[oldMarkdown\], \{ type: 'text\/markdown;charset=utf-8' \}\)/)
assert.match(sharedNotes, /anchor\.download = selected\.id \+ '-r' \+ oldVersion\.revision \+ '\.md'/)
assert.match(sharedNotes, /下载此版本 Markdown/)
assert.match(screen, /selectedVersion = version/)
assert.match(screen, /fileExporter\([\s\S]*?defaultFilename: noteID \+ "-r" \+ String\(selectedVersion\?\.revision \?\? 0\)/)
assert.match(screen, /导出此版本 Markdown/)
assert.match(nativeAndroid, /val content = controller\.notesPreviousMarkdown\(nodeID, version\.id\)/)
assert.match(nativeAndroid, /ActivityResultContracts\.CreateDocument\("text\/markdown"\)/)
assert.match(nativeAndroid, /controller\.state\.value\.nativeUiSessionId == ownerEpoch/)
assert.match(nativeAndroid, /NativeNotesMarkdownPreview\(\s*controller, noteID, ownerEpoch, content/)
assert.match(nativeAndroid, /导出此版本 Markdown/)

assert.match(sharedNotes, /const historyReadSeq = useRef\\(0\\)/)
assert.match(sharedNotes, /const historyGeneration = \\+\\+historyReadSeq\\.current/)
assert.match(sharedNotes, /historyReadSeq\\.current === historyGeneration/)
assert.match(sharedNotes, /onClose=\\{closeHistory\\}/)
assert.match(screen, /@State private var versionReadGeneration = 0/)
assert.match(screen, /guard generation == versionReadGeneration else \\{ return \\}/)

console.log('iOS Notes history image readback and explicit Shortcut source identity: PASS')
