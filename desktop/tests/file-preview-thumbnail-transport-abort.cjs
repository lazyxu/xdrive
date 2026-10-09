'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const sourcePath = path.join(root, 'ui/shared/src/mui/FilePreviewImage.tsx')
const content = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(content, {
  fileName: sourcePath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const passthrough = tag => ({ children }) => React.createElement(tag, null, children)
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', compiled)(
  moduleRecord.exports, moduleRecord, name => {
    if (name === '@mui/material') {
      return {
        Box: passthrough('div'),
        Typography: passthrough('span'),
        CircularProgress: passthrough('span'),
      }
    }
    if (name === './FilePreviewTransformedMedia') {
      return { XDriveTransformedImagePreview: passthrough('img') }
    }
    // This test asserts transport ownership; UI progress rendering is
    // independent and must not mask or relax real abort/disconnect checks.
    if (name === './MediaLoadProgress') {
      return { XDriveMediaLoadingProgress: passthrough('span') }
    }
    return require(name)
  },
)
const { XDriveDecodedImagePreview } = moduleRecord.exports

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, message, limitMs = 1800) {
  const begin = Date.now()
  while (!predicate()) {
    if (Date.now() - begin > limitMs) throw new Error('timeout: ' + message)
    await sleep(5)
  }
}
async function withSlowHTTP(run) {
  const states = new Map()
  const server = http.createServer((request, response) => {
    const nodeID = Number(new URL(request.url, 'http://localhost').pathname.slice(1))
    let state = states.get(nodeID)
    if (!state) {
      state = { started: 0, active: 0, earlyClosed: 0, bodyBytes: 0 }
      states.set(nodeID, state)
    }
    state.started++
    state.active++
    const timer = setTimeout(() => {
      if (response.destroyed) return
      state.bodyBytes += 8192
      response.writeHead(200, { 'Content-Type': 'image/jpeg' })
      response.end(Buffer.alloc(8192))
    }, 500)
    response.on('close', () => {
      clearTimeout(timer)
      state.active--
      if (!response.writableEnded) state.earlyClosed++
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const loader = async (target, signal) => {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/' + target.id,
      { signal },
    )
    await response.arrayBuffer()
    return 'https://example.invalid/' + target.id + '.jpeg'
  }
  try {
    await run({ loader, state: id => states.get(id) ||
      { started: 0, active: 0, earlyClosed: 0, bodyBytes: 0 } })
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
const node = id => ({ id, revision: 3, kind: 'file', name: id + '.jpeg' })
function frame(id, loadImagePreview) {
  return React.createElement(XDriveDecodedImagePreview, {
    target: node(id),
    kind: 'image',
    loadImagePreview,
    fallback: React.createElement('span', null, 'unavailable'),
    imageFit: 'contain',
    minHeight: 160,
  })
}

test('shared Viewer/Inspector thumbnail unmount must close its real pending HTTP GET', async () => {
  const samples = []
  for (let repeat = 1; repeat <= 3; repeat++) {
    await withSlowHTTP(async ({ loader, state }) => {
      const id = 700 + repeat
      let renderer
      try {
        await act(async () => { renderer = create(frame(id, loader)) })
        await until(() => state(id).started === 1, 'thumbnail GET started')
        await act(async () => renderer.unmount())
        renderer = null
        await sleep(160)
        const sample = { repeat, id, ...state(id) }
        samples.push(sample)
        console.log('PREVIEW_IMAGE_THUMB_ABORT_SAMPLE ' + JSON.stringify(sample))
      } finally {
        if (renderer) await act(async () => renderer.unmount())
      }
    })
  }
  assert.equal(samples.length, 3)
  for (const result of samples) {
    assert.equal(result.started, 1)
    assert.equal(result.earlyClosed, 1,
      'View teardown must abort actual HTTP fetch, not just suppress stale React updates')
    assert.equal(result.active, 0, 'no abandoned thumbnail GET may stay alive at +160ms')
    assert.equal(result.bodyBytes, 0, 'abandoned thumbnail must not transfer its late response')
  }
})

test('Viewer image target change aborts old thumbnail without stopping current request', async () => {
  await withSlowHTTP(async ({ loader, state }) => {
    let renderer
    try {
      await act(async () => { renderer = create(frame(810, loader)) })
      await until(() => state(810).started === 1, 'first image GET')
      await act(async () => renderer.update(frame(811, loader)))
      await until(() => state(811).started === 1, 'new image GET')
      await sleep(160)
      const before = { ...state(810) }
      const now = { ...state(811) }
      console.log('PREVIEW_IMAGE_THUMB_REPLACE_SAMPLE ' + JSON.stringify({ before, now }))
      assert.equal(before.earlyClosed, 1, 'superseded image thumbnail transport should abort')
      assert.equal(before.active, 0)
      assert.equal(before.bodyBytes, 0)
      assert.equal(now.started, 1)
      assert.equal(now.active, 1, 'new image thumbnail must stay independent')
      assert.equal(now.earlyClosed, 0)
    } finally {
      if (renderer) await act(async () => renderer.unmount())
    }
  })
})
