const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const preview = read('ui', 'shared', 'src', 'file-preview.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const webApi = read('web', 'src', 'api.ts')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const server = read('internal', 'api', 'file_text_preview.go')

test('safe text-preview contract excludes active and secret-prone content', () => {
  for (const token of ['XDriveFileTextPreview', 'xDriveFileSupportsTextPreview', "'txt'", "'json'", "'md'"]) {
    assert.ok(preview.includes(token), 'missing shared text-preview token: ' + token)
  }
  for (const forbidden of ["'html'", "'svg'", "'pem'", "'key'", "'.env'"]) {
    assert.equal(preview.includes(forbidden), false, 'unsafe preview extension leaked into shared allowlist: ' + forbidden)
  }
  for (const token of [
    'fileTextPreviewLimit = 64 << 10',
    'bytes.IndexByte(data, 0)',
    'utf8.Valid(data)',
    'http.StatusUnsupportedMediaType',
    'X-Content-Type-Options',
  ]) {
    assert.ok(server.includes(token), 'missing bounded server text-preview guard: ' + token)
  }
})

test('shared Inspector renders preview as inert plain text', () => {
  for (const token of [
    'loadTextPreview?:',
    'XDriveLazyFileTextPreview',
    'xDriveFileSupportsTextPreview(inspectorItem.name, inspectorItem.kind)',
    'component="pre"',
    '仅显示前 64 KiB',
  ]) {
    assert.ok(explorer.includes(token), 'missing shared Inspector text preview: ' + token)
  }
  assert.equal(explorer.includes('dangerouslySetInnerHTML'), false, 'Inspector text preview must never inject active markup')
})

test('Web and Desktop load preview through authenticated platform adapters', () => {
  assert.ok(webApi.includes('fileTextPreview(id: number)'), 'Web API text preview method is missing')
  assert.ok(webExplorer.includes('api.fileTextPreview(Number(item.id))'), 'Web Explorer preview adapter is missing')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudTextPreview(Number(item.id))'), 'Desktop Explorer preview adapter is missing')
  assert.ok(desktopExplorer.includes('textPreviewSupported ? loadTextPreview : undefined'), 'Desktop preview must be capability gated')
  assert.ok(desktopApp.includes("capabilities.includes('file-text-preview')"), 'Desktop App capability gate is missing')
  for (const [label, source, tokens] of [
    ['preload', preload, ['cloudTextPreview', 'agent:cloud-text-preview']],
    ['Electron main', desktopMain, ['agent:cloud-text-preview', "file-text-preview"]],
    ['Agent client', agentClient, ['cloudFileTextPreview', '/v1/cloud/text-preview']],
    ['Agent cloud adapter', agentCloud, ['CloudFileTextPreview', 'FileTextPreview']],
    ['Agent IPC', agentIPC, ['file-text-preview', '/v1/cloud/text-preview', 'cloudFileTextPreview']],
  ]) {
    for (const token of tokens) {
      assert.ok(source.includes(token), label + ' preview bridge missing: ' + token)
    }
  }
})
