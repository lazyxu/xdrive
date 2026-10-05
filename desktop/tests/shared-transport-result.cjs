const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const transport = read('ui', 'shared', 'src', 'transport-result.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGalleryAdapter.ts')
const sources = read('ui', 'shared', 'src', 'mui', 'SourceManagerAdapter.ts')
const dialogs = read('ui', 'shared', 'src', 'mui', 'FileDialogAdapters.ts')
const serverUpdate = read('ui', 'shared', 'src', 'mui', 'ServerUpdateController.ts')

test('shared transport result owns wrapped-result detection and error normalization', () => {
  for (const token of [
    'export type XDriveTransportError',
    'status?: number',
    'code?: string',
    'detail?: string',
    'export type XDriveTransportResult<',
    'export function isXDriveWrappedTransportResult',
    "'ok' in value",
    "'data' in value || 'error' in value",
    'export function xDriveTransportError',
    'result.status = error.status',
    'result.code = error.code',
    'result.detail = error.detail',
    'export async function resolveXDriveTransport',
    'throw xDriveTransportError(result.error)',
    'export async function resolveOptionalXDriveTransport',
    'return result.ok ? result.data : undefined',
  ]) {
    assert.ok(transport.includes(token), `shared transport result missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './transport-result'"), 'framework-neutral transport result must be exported')
})

test('domain adapters keep their public transport names but share one resolver implementation', () => {
  for (const [name, source, resultType] of [
    ['Gallery', gallery, 'XDriveMediaGalleryTransportResult'],
    ['SourceManager', sources, 'XDriveSourceManagerTransportResult'],
    ['FileDialog', dialogs, 'XDriveFileDialogTransportResult'],
    ['ServerUpdate', serverUpdate, 'XDriveServerUpdateTransportResult'],
  ]) {
    assert.ok(source.includes(resultType), `${name} must keep its domain transport result name`)
    assert.ok(source.includes('XDriveTransportResult'), `${name} must alias the generic transport result`)
    assert.ok(source.includes('resolveXDriveTransport'), `${name} must use the generic transport resolver`)
    assert.equal(source.includes('function isWrappedTransportResult'), false, `${name} must not duplicate wrapped-result detection`)
  }

  assert.ok(sources.includes('export function resolveXDriveSourceManagerTransport'), 'SourceManager compatibility resolver must remain exported')
  assert.ok(dialogs.includes('export function resolveXDriveFileDialogTransport'), 'FileDialog compatibility resolver must remain exported')
  assert.ok(sources.includes('resolveOptionalXDriveTransport'), 'SourceManager optional transport failures must keep their non-fatal behavior')
})
