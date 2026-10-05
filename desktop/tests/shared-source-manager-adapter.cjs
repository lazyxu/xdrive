const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const factory = read('ui', 'shared', 'src', 'mui', 'SourceManagerAdapter.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'sourceManagerAdapter.ts')

test('shared SourceManager adapter factory owns transport normalization and overview synthesis', () => {
  for (const token of [
    'export interface XDriveSourceManagerPort',
    'XDriveSourceManagerTransportResult',
    'resolveXDriveSourceManagerTransport',
    'return resolveXDriveTransport(value)',
    'resolveOptionalXDriveTransport',
    'synthesizedSourceOverview',
    'port.sourceOverview',
    'port.sources',
    'port.sourceRuns(source.id, 1)',
    'externalSourceConnectorProfile(source.kind, source.direction).credential',
    'port.sourceCredentialStatus(source.id)',
    'latest_run: runs?.[0]',
    'createXDriveSourceManagerAdapter',
  ]) {
    assert.ok(factory.includes(token), `shared SourceManager adapter missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './SourceManagerAdapter'"), 'shared SourceManager adapter factory must be exported')
})

test('Web feeds XDriveApi directly through the shared SourceManager factory', () => {
  assert.ok(web.includes('createXDriveSourceManagerAdapter(api)'), 'Web must use the shared SourceManager factory')
  assert.ok(web.includes('adapter={sourceManagerAdapter}'), 'Web must pass the normalized adapter to SourceManager')
  assert.equal(web.includes('adapter={api}'), false, 'Web must not bypass the shared SourceManager factory')
})

test('Desktop keeps only Agent transport mapping and target browsing local', () => {
  for (const token of [
    'createXDriveSourceManagerAdapter',
    'resolveXDriveSourceManagerTransport',
    'sources: () => agent.getSources()',
    'sourceCredentialStatus: (sourceID) => agent.getSourceCredential(sourceID)',
    'sourceRuns: (sourceID, limit, offset) => agent.getSourceRuns(sourceID, limit, offset)',
    'sourceBrowseDirectories: (sourceID, path, limit, offset)',
    'agent.browseSourceDirectories(sourceID, path, limit, offset)',
    'desktopSourceTargetBrowser',
    'window.xdriveDesktop.agent.cloudRoot()',
    'window.xdriveDesktop.agent.cloudChildren(parentID)',
  ]) {
    assert.ok(desktop.includes(token), `Desktop SourceManager transport mapping missing: ${token}`)
  }
  for (const token of [
    'function unwrap<T>',
    'function credentialOrUndefined',
    'externalSourceConnectorProfile',
    'Promise.all(sources.map',
  ]) {
    assert.equal(desktop.includes(token), false, `Desktop must not duplicate shared SourceManager normalization: ${token}`)
  }
})
