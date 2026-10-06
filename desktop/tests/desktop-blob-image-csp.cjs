const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const html = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'index.html'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const galleryAdapter = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'MediaGalleryAdapter.ts'), 'utf8')

test('Desktop CSP allows Blob-backed image thumbnails', () => {
  assert.ok(
    html.includes("img-src 'self' data: blob: http://127.0.0.1:*;"),
    'Desktop img-src CSP must allow blob: URLs used by binary thumbnails',
  )
  assert.ok(
    explorer.includes('URL.createObjectURL(blob)'),
    'Desktop FileExplorer should still expose binary thumbnails through Blob URLs',
  )
  assert.ok(
    galleryAdapter.includes('URL.createObjectURL(new Blob('),
    'shared Gallery binary resources should still expose Blob URLs',
  )
})
