#!/usr/bin/env node
// DSM Notes image paths must remain fixed Owner-scoped CGI/Agent capabilities.
// This is a source-level contract; physical NAS acceptance is separate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const endpoint = read('internal/synologyui/owner_notes_images.go')
const notesEndpoint = read('internal/synologyui/owner_notes.go')
const notesAgent = read('internal/localbackupipc/owner_notes.go')
const agent = read('internal/localbackupipc/owner_notes_images.go')
const browser = read('ui/shared/src/synology-backup-adapter.ts')
const port = read('web/src/synologyNotesPort.ts')
const host = read('web/src/synology.tsx')
const notesPage = read('ui/shared/src/mui/NotesPage.tsx')

for (const name of ['cloud-notes-image-capability', 'cloud-notes-image-upload', 'cloud-notes-image-import', 'cloud-notes-image-read']) {
  assert.ok(cgi.includes('"'+name+'"'), 'CGI must reject unknown Notes image methods: '+name)
  assert.ok(browser.includes("'"+name+"'"), 'Browser must use only allowlisted Notes image CGI: '+name)
}
assert.match(gateway, /isDSMOwnerNotesImageRoute\(r\.URL\.Path\)/)
assert.match(gateway, /isDSMOwnerNotesImageWrite\(r\.URL\.Path\)/)
assert.match(gateway, /serveDSMOwnerNotesImage\(w, r, ctx, agent, key, username\)/)
assert.match(gateway, /dsmNotesImageUploadJSONMax/)
assert.match(endpoint, /parseDSMNotesImageMutation\(r \*http\.Request\)/)
assert.match(endpoint, /subtle\.ConstantTimeCompare/)
assert.match(endpoint, /ValidateOwnerQuota/)
assert.match(endpoint, /OwnerNotesUploadImage\(ctx, input\.ID, input\.Image\)/)
assert.match(endpoint, /OwnerNotesImportIOSImage\(ctx, input\.ID, input\.Image\)/)
assert.match(endpoint, /cloud-notes-image-import/)
assert.match(endpoint, /NotesImageFilename\(params\.Get\("id"\)/)
assert.match(agent, /hasCapability\(c\.capabilities, "cloud-notes-images"\)/)
assert.match(agent, /NotesImageFilename\(noteID, relativePath\)/)
assert.match(agent, /sha256\.Sum256\(out\.Image\)/)
assert.match(agent, /OwnerNotesImportIOSImage\(/)
assert.match(agent, /\/v1\/cloud\/notes\/ios-import\//)
assert.doesNotMatch(endpoint, /ReverseProxy|http\.Proxy|client\.request\(|ServerBearer/)

for (const name of ['cloud-notes-import-ios']) {
  assert.ok(cgi.includes('"' + name + '"'), 'CGI must allow only explicit Notes archive import: ' + name)
  assert.ok(browser.includes("'"+name+"'"), 'DSM browser must use the fixed Notes import CGI: ' + name)
}
assert.match(notesEndpoint, /OwnerNotesImportIOS\(ctx,\s*client\.NotesImportWrite/)
assert.match(notesEndpoint, /validDSMNotesImportIdentity/)
assert.match(notesAgent, /OwnerNotesImportIOS\(/)
assert.match(notesAgent, /\/v1\/cloud\/notes\/import-ios/)
assert.match(browser, /notesImportIOS\(/)
assert.match(browser, /notesImportIOSImage\(/)
assert.match(port, /async importIOSMarkdown\(value\)/)
assert.match(port, /async importIOSMarkdownBundle\(files: readonly File\[\]/)
assert.match(port, /xDriveNotesPlanManualExport\(markdown, markdownFile, assets\)/)
assert.match(port, /manual:' \+ crypto\.randomUUID\(\)/)
assert.match(browser, /crypto\.subtle\.digest\('SHA-256', data\)/)
assert.match(browser, /notesBase64\(bytes\)/)
assert.match(browser, /notesAssetPath\(id, relativePath\)/)
assert.match(browser, /new Blob\(\[owned\]/)
assert.match(port, /\.\.\.\(imagesEnabled \? \{/)
assert.match(port, /readImageBlob\(noteID: string, path: string/)
assert.match(host, /await cgi\.notesImagesAvailable\(controller\.signal\)/)
assert.match(host, /setNotesImagesEnabled\(sameOwner && imageOK\)/)
assert.match(host, /showNotes: Boolean\(notesPort\)/)
assert.match(notesPage, /port\.uploadImage && <Button/)
assert.match(notesPage, /port\.readImageBlob\(selected\.id, path, controller\.signal\)/)
console.log('DSM Notes image Host: bounded Owner-only CGI, Agent and shared UI contract verified')
