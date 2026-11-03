import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(dir, '../../ui/shared/src/notes-markdown-policy.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'real notes URL policy transpiles')
const policy = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputText).toString('base64'))

const accepted = [
  '_assets/abc/file.png',
  '_assets/笔记-一/照片.jpg',
  '_assets/id-123/photo 1.webp',
]
for (const image of accepted) {
  assert.equal(policy.xDriveNotesSafeRelativeAsset(image), true, image)
}
const rejected = [
  '', '/@xDrive/private.png', 'https://example.com/a.jpg',
  '//example.com/a.jpg', 'data:image/png;base64,AAAA',
  '_assets/../passwd', '_assets/item/../../private',
  '_assets//photo.png', '_assets/./photo.png', '_assets/foo\\bar.png',
  '_assets/foo/file.png?token=secret', '_assets/foo/file.png#fragment',
  '_assets/%2e%2e/private.png', '_assets/foo%2fbar/photo.png',
  '_assets/foo/file.png\n', '_assets/foo/\u0000bad',
  '_assets/' + 'a'.repeat(510) + '/x.png',
]
for (const image of rejected) {
  assert.equal(policy.xDriveNotesSafeRelativeAsset(image), false, image)
}
for (const href of ['javascript:alert(1)', 'data:text/html,evil', 'file:///private',
  'ftp://server/file', '//example.com/relative', 'https://user:password@example.com']) {
  assert.equal(policy.xDriveNotesSafeExternalLink(href), null, href)
}
assert.equal(policy.xDriveNotesSafeExternalLink('https://example.com/page'),
  'https://example.com/page')
assert.equal(policy.xDriveNotesSafeExternalLink('mailto:hello@example.com'),
  'mailto:hello@example.com')

// Rendering is restricted to JSX text nodes and an approved Owner resolver;
// never treat imported Markdown as trusted HTML or an external image URL.
const preview = readFileSync(resolve(dir,
  '../../ui/shared/src/mui/NotesMarkdownPreview.tsx'), 'utf8')
assert.match(preview, /xDriveNotesSafeRelativeAsset\(assetPath\)/)
assert.doesNotMatch(preview, /dangerouslySetInnerHTML/)
assert.match(preview, /referrerPolicy="no-referrer"/)
const page = readFileSync(resolve(dir, '../../ui/shared/src/mui/NotesPage.tsx'), 'utf8')
assert.match(page, /key=\{port\.ownerScopeKey\}/)
assert.match(page, /expected_revision: selected\.revision/)
assert.match(page, /if \(hasRevisionConflict\(error\)\)/)
assert.match(page, /selected\.source !== 'mine'/)
console.log('Notes Markdown safe URLs, Owner-bound images and editor boundaries: PASS')
