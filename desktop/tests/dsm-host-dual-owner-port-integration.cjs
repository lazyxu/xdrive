'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'web/src/synologyHost.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

const local = {
  authorizedOwnerClient: true,
  diagnostics: signal => {
    assert.ok(signal instanceof AbortSignal)
    return Promise.resolve({ checks: [], summary: { pass: 0, warn: 0, fail: 0 } })
  },
}
const gallery = { readOnlyOwnerGallery: true }
const seen = []
const mod = { exports: {} }
new Function('module', 'exports', 'require', 'window', compiled.outputText)(
  mod, mod.exports, name => {
    if (name === '@xdrive/ui/mui') return {
      createXDriveSynologyBackupLocalClient: href => { seen.push(href); return local },
      createXDriveSynologyOwnerBackupSource: client => ({ client }),
      createXDriveSynologyCloudStorageDataSource: client => ({ client }),
      createXDriveSynologyBrowserStorageSource: () => ({ browser: true }),
    }
    if (name === '../../ui/shared/src/mui/SynologyOwnerGallerySource') return {
      createXDriveSynologyOwnerGallerySource: client => {
        assert.strictEqual(client, local)
        return gallery
      },
    }
    throw Error('Unexpected DSM Host dependency: ' + name)
  },
  { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
)
const create = mod.exports.createXDriveSynologyHost

test('one real authenticated DSM client powers both Files and shared Gallery', () => {
  const host = create()
  assert.equal(host.platform, 'synology')
  assert.strictEqual(host.services.localBackupClient, local)
  assert.strictEqual(host.services.ownerFilesPage.client, local)
  assert.strictEqual(host.services.galleryPage.source, gallery)
  assert.equal(host.services.galleryPage.pageSize, 100)
  assert.equal(typeof host.services.diagnosticsSource.read, 'function')
  assert.match(host.services.diagnosticsSource.scopeNotice, /未检测/)
  assert.match(host.services.diagnosticsSource.failureMessage, /未完成诊断/)
  assert.deepEqual(seen, ['https://nas.example/webman/3rdparty/xdrivenas/backup.cgi'])
  assert.equal(host.adminRoleVerified, undefined,
    'DSM login alone never authorizes Server administrator pages')
})

test('Gallery cannot silently re-enable missing Owner Files write operations', () => {
  const h = create()
  const disabled = h.services.ownerFilesPage.unavailableActions
  for (const action of ['search', 'createFolder', 'uploadFiles', 'uploadFolder',
    'copy', 'cut', 'paste', 'delete', 'rename', 'moveTo', 'copyTo', 'manageTags']) {
    assert.equal(typeof disabled[action], 'string', action)
    assert.ok(disabled[action].length > 5, action)
  }
  assert.equal(h.services.filesUnavailableActions, undefined,
    'obsolete top-level Files fallback is forbidden')
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|fetch\s*\(/)
  assert.doesNotMatch(source, /<XDriveMediaGalleryPage|<XDriveSynologyOwnerFilesPage/)
})

test('Diagnostics stays a real, cancellable scoped Host read without native JSX', async () => {
  const host = create()
  const controller = new AbortController()
  const result = await host.services.diagnosticsSource.read(controller.signal)
  assert.deepEqual(result.checks, [])
  assert.equal(result.summary.pass, 0)
  assert.doesNotMatch(source, /XDriveSynologyDiagnosticsPanel|XDriveDiagnosticsHostController|window\.xdriveDesktop/)
})
