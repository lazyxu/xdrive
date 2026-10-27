'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Desktop opt-in Viewer correlation reaches only the existing authenticated download route', () => {
  const model = read('internal/transfer/model.go')
  const cloud = read('cmd/xdrive-agent/cloud_files.go')
  const ipc = read('cmd/xdrive-agent/desktop_ipc.go')
  const agent = read('desktop/src/main/agent_client.cts')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const types = read('desktop/src/renderer/global.d.ts')
  assert.match(model, /ClientRequestID\s+string\s+`json:"client_request_id,omitempty"`/,
    'only Agent Task contains the optional request correlation')
  assert.match(model, /ClientRequestID:\s+spec\.ClientRequestID,/,
    'Agent Task must copy its own new transfer Spec identity')
  assert.match(cloud, /ClientRequestID:\s*clientRequestID/,
    'single-file CloudDownload must attach the nonce before network I/O')
  assert.match(ipc, /validAgentCloudDownloadClientRequestID\(input\.ClientRequestID\)/,
    'authenticated Agent IPC must reject malformed nonces')
  assert.match(ipc, /CloudDownloadWithClientRequestID\(r\.Context\(\), input\.ID, input\.Destination, input\.ClientRequestID\)/,
    'Agent must never infer correlation from filename/Node alone')
  assert.match(agent, /cloudDownloadWithClientRequestID\(id: number, destination: string, clientRequestID: string\)/)
  assert.match(main, /\/\^\[0-9a-f\]\{32\}\$\//,
    'Electron Main must reject arbitrary input before displaying SaveDialog')
  assert.match(main, /cloudDownloadWithClientRequestID\(id, selected\.filePath, clientRequestID\)/,
    'Main must forward exact caller nonce only after explicit save destination')
  assert.match(main, /await requireAgentClient\(\)\.cloudDownload\(id, selected\.filePath\)/,
    'legacy Desktop files/album/bulk downloads must keep their original path')
  assert.match(preload, /cloudDownload: \(id: number, name: string, clientRequestID\?: string\)/,
    'Preload allows only an optional typed correlation')
  assert.match(types, /cloudDownload: \(id: number, name: string, clientRequestID\?: string\)/,
    'Renderer needs no extra privileged channel or token')
  assert.equal(main.match(/ipcMain\.handle\('agent:cloud-download'/g)?.length, 1,
    'correlated and legacy downloads must use exactly one existing main IPC handler')
  assert.doesNotMatch(agent, /Math\.random|Date\.now\(\).*client_request_id/,
    'Agent must never guess a correlation from non-random data')
})

test('Agent correlation must not become an authorization or a new download route', () => {
  const ipc = read('cmd/xdrive-agent/desktop_ipc.go')
  const cloud = read('cmd/xdrive-agent/cloud_files.go')
  const model = read('internal/transfer/model.go')
  assert.match(ipc, /else if err := h\.ctrl\.CloudDownload\(r\.Context\(\), input\.ID, input\.Destination\)/,
    'requests without nonce remain on the legacy Controller method')
  assert.match(cloud, /return c\.CloudDownloadWithClientRequestID\(ctx, id, destination, ""\)/)
  assert.match(cloud, /if clientRequestID != "" && !validAgentCloudDownloadClientRequestID\(clientRequestID\)/)
  assert.match(cloud, /if err := replaceDownloadedFile\(tmpPath, destination\); err != nil/,
    'same atomic destination replacement must remain the completion gate')
  assert.match(model, /ClientRequestID\s+string\s+`json:"client_request_id,omitempty"`/)
  assert.doesNotMatch(ipc, /"\/(?:v1\/)?cloud\/download\/correlated"/,
    'no second Agent content route may be created')
})
