const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const load = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const explorer = load('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const details = load('ui', 'shared', 'src', 'mui', 'MediaGalleryDetails.tsx')
const fileProperties = load('ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx')

const start = explorer.indexOf('const mediaFileRows:')
const end = explorer.indexOf('const selectedSize =', start)
assert.ok(start >= 0 && end > start, 'single-media FileExplorer rows must remain in the shared adapter')
const mediaRows = explorer.slice(start, end)

test('media Inspector preserves the FileExplorer ID and source fields', () => {
  assert.match(mediaRows, /\['ID', String\(propertiesDialogItem\.id\)\]/)
  assert.match(mediaRows, /\['来源', propertiesDialogSource\]/)
  assert.match(explorer, /propertiesStatsState\.stats\?\.sources\?\.length/)
})

test('media Inspector also keeps platform supplied custom file properties', () => {
  assert.match(mediaRows, /\(propertiesDialogItem\.properties \?\? \[\]\)\.map\(/)
  assert.match(mediaRows, /property\.label, property\.value/)
  assert.match(mediaRows, /Array<\[string, ReactNode\]>/)
  assert.match(fileProperties, /value: ReactNode/)
})

test('shared media attribute rows accept ReactNode without changing EXIF model', () => {
  assert.match(details, /import type \{ ReactNode \} from 'react'/)
  assert.match(details, /extraFileRows\?: Array<\[label: string, value: ReactNode\]>/)
  assert.match(details, /function MediaDetailsRows\(\{ rows \}: \{ rows: readonly \(readonly \[label: string, value: ReactNode\]\)\[\] \}\)/)
  assert.match(details, /type MediaDetailRow = \[label: string, value: string\]/)
  assert.match(details, /<MediaDetailsRows rows=\{sectionRows\.files\} \/>/)
  assert.match(details, /<MediaDetailsRows rows=\{extraFileRows\} \/>/)
})

test('nonmedia and multi-selection Properties keep their original dialog and source fields', () => {
  assert.match(explorer, /const propertiesDialogProperties =/)
  assert.match(explorer, /propertiesForItem\(propertiesDialogItem, propertiesDialogSource\)/)
  assert.match(explorer, /propertiesItems\.length > 1/)
  assert.match(explorer, /open=\{propertiesItems\.length > 0 && !showMediaProperties\}/)
  assert.match(explorer, /properties=\{mediaPropertiesError/)
  assert.match(explorer, /<XDriveMediaDetailsInspector/)
})
