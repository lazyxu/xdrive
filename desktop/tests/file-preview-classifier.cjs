const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function loadPreviewModel() {
  const sourcePath = path.join(
    __dirname,
    '..',
    '..',
    'ui',
    'shared',
    'src',
    'file-preview.ts',
  )
  const source = fs.readFileSync(sourcePath, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  )
  assert.deepEqual(errors, [], 'shared file-preview.ts must transpile without syntax errors')

  const module = { exports: {} }
  const execute = new Function('require', 'module', 'exports', result.outputText)
  execute(require, module, module.exports)
  return module.exports
}

const {
  xDriveClassifyFilePreview,
  xDriveFileSupportsTextPreview,
  xDriveFileUsesRawCompatibilityPreview,
} = loadPreviewModel()

test('binary preview classification is extension-allowlist based', () => {
  const cases = [
    [{ name: 'photo.jpg', kind: 'file', mimeType: 'image/svg+xml' }, 'image'],
    [{ name: 'PHOTO.JPEG', kind: 'file', mimeType: 'application/octet-stream' }, 'image'],
    [{ name: 'movie.mp4', kind: 'file', mimeType: 'text/html' }, 'video'],
    [{ name: 'song.mp3', kind: 'file', mimeType: 'application/octet-stream' }, 'audio'],
    [{ name: 'document.pdf', kind: 'file', mimeType: 'text/plain' }, 'pdf'],
    [{ name: 'photo.LIVP', kind: 'file', mimeType: 'application/octet-stream' }, 'live_photo'],
  ]

  for (const [target, expected] of cases) {
    assert.equal(
      xDriveClassifyFilePreview(target),
      expected,
      JSON.stringify(target),
    )
  }
})

test('MIME metadata cannot broaden binary previewability', () => {
  const cases = [
    { name: 'payload.bin', kind: 'file', mimeType: 'image/png' },
    { name: 'payload.bin', kind: 'file', mimeType: 'video/mp4' },
    { name: 'payload.bin', kind: 'file', mimeType: 'audio/mpeg' },
    { name: 'payload.bin', kind: 'file', mimeType: 'application/pdf' },
  ]

  for (const target of cases) {
    assert.equal(
      xDriveClassifyFilePreview(target),
      'none',
      JSON.stringify(target),
    )
  }
})

test('directories are never preview-classified as files', () => {
  assert.equal(
    xDriveClassifyFilePreview({
      name: 'photo.jpg',
      kind: 'dir',
      mimeType: 'image/jpeg',
    }),
    'none',
  )
})

test('bounded text preview classification covers common source and config files', () => {
  for (const name of [
    'README',
    'notes.txt',
    'index.js',
    'header.h',
    'source.cpp',
    'main.go',
    'index.html',
    'icon.svg',
    '.env',
    '.env.local',
    '.eslintrc.json',
  ]) {
    assert.equal(xDriveFileSupportsTextPreview(name, 'file'), true, name)
    assert.equal(xDriveClassifyFilePreview({ name, kind: 'file' }), 'text', name)
  }
  assert.equal(xDriveFileSupportsTextPreview('README', 'dir'), false)
})


test('RAW embedded JPEG compatibility previews are extension-scoped, never MIME-guessable', () => {
  for (const name of ['photo.DNG', 'clip.nef', 'frame.ARW', 'canvas.Cr3']) {
    assert.equal(xDriveFileUsesRawCompatibilityPreview(name), true, name)
    assert.equal(xDriveClassifyFilePreview({ name, kind: 'file' }), 'image')
  }
  for (const name of ['photo.jpg', 'photo.heic', 'movie.mp4', 'payload.bin', 'photo.cr2', 'photo.raf']) {
    assert.equal(xDriveFileUsesRawCompatibilityPreview(name), false, name)
  }
  assert.equal(xDriveClassifyFilePreview({ name: 'payload.bin', kind: 'file', mimeType: 'image/x-adobe-dng' }), 'none')
  assert.equal(xDriveClassifyFilePreview({ name: 'photo.dng', kind: 'dir' }), 'none')
})
