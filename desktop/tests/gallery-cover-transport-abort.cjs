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
const pathToComponent = path.join(root, 'ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
const source = fs.readFileSync(pathToComponent, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: pathToComponent,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const passthrough = (tag) => ({ children }) => React.createElement(tag, null, children)
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', compiled)(
  moduleRecord.exports, moduleRecord, (name) => {
    if (name === '@mui/material') {
      return { Box: passthrough('div'), Skeleton: passthrough('div') }
    }
    if (name === '@mui/icons-material') {
      return { Image: passthrough('span'), Movie: passthrough('span') }
    }
    if (name === './MediaLoadProgress') {
      return { XDriveMediaLoadingProgress: passthrough('div') }
    }
    if (name === './MediaGalleryVideoPoster') {
      return { xDriveCaptureVideoPosterBlob: async () => null,
        xDriveResolveMediaVideoPoster: async () => null }
    }
    return require(name)
  },
)
const { XDriveMediaAsyncThumbnail } = moduleRecord.exports

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, message, limitMs = 2000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > limitMs) throw new Error('timeout: ' + message)
    await sleep(5)
  }
}

async function withSlowHTTP(run) {
  const states = new Map()
  const server = http.createServer((request, response) => {
    const id = Number(new URL(request.url, 'http://localhost').pathname.slice(1))
    let state = states.get(id)
    if (!state) {
      state = { started: 0, active: 0, earlyClosed: 0, payloadBytes: 0 }
      states.set(id, state)
    }
    state.started++
    state.active++
    const timeout = setTimeout(() => {
      if (response.destroyed) return
      state.payloadBytes += 8192
      response.end(Buffer.alloc(8192))
    }, 500)
    response.on('close', () => {
      clearTimeout(timeout)
      state.active--
      if (!response.writableEnded) state.earlyClosed++
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const loader = async (nodeID, signal) => {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/' + nodeID, { signal })
    await response.arrayBuffer()
    return 'https://example.invalid/' + nodeID + '.jpg'
  }
  try {
    await run({
      states,
      loader,
      state: (id) => states.get(id) ||
        { started: 0, active: 0, earlyClosed: 0, payloadBytes: 0 },
    })
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

function thumbnail(nodeID, loadThumbnail) {
  return React.createElement(XDriveMediaAsyncThumbnail, {
    nodeID,
    loadThumbnail,
    alt: 'photo',
    fallback: React.createElement('span', null, 'unavailable'),
  })
}

test('Gallery cover unmount must abort real pending HTTP (n=3, 500ms delayed, +160ms)', async () => {
  const samples = []
  for (let sample = 1; sample <= 3; sample++) {
    await withSlowHTTP(async ({ state, loader }) => {
      let renderer
      try {
        await act(async () => {
          renderer = create(thumbnail(100 + sample, loader))
        })
        await until(() => state(100 + sample).started === 1, 'cover GET started')
        await act(async () => renderer.unmount())
        renderer = null
        await sleep(160)
        const observed = { sample, event: 'unmount', ...state(100 + sample) }
        samples.push(observed)
        console.log('GALLERY_COVER_ABORT_SAMPLE ' + JSON.stringify(observed))
      } finally {
        if (renderer) await act(async () => renderer.unmount())
      }
    })
  }
  assert.equal(samples.length, 3)
  for (const result of samples) {
    assert.equal(result.started, 1)
    assert.equal(result.earlyClosed, 1,
      'unmount must close the actual HTTP request, not merely discard React state')
    assert.equal(result.active, 0,
      'no stale thumbnail GET may remain active at +160ms')
    assert.equal(result.payloadBytes, 0,
      'abandoned cover must not emit stale response payload')
  }
})

test('Gallery cover node change aborts old GET without cancelling new owner', async () => {
  await withSlowHTTP(async ({ state, loader }) => {
    let renderer
    try {
      await act(async () => { renderer = create(thumbnail(201, loader)) })
      await until(() => state(201).started === 1, 'old GET started')
      await act(async () => { renderer.update(thumbnail(202, loader)) })
      await until(() => state(202).started === 1, 'new GET started')
      await sleep(160)
      const old = { ...state(201) }
      const current = { ...state(202) }
      console.log('GALLERY_COVER_REPLACE_SAMPLE ' + JSON.stringify({ old, current }))
      assert.equal(old.started, 1)
      assert.equal(old.earlyClosed, 1,
        'switching cover should close only obsolete HTTP')
      assert.equal(old.active, 0)
      assert.equal(old.payloadBytes, 0)
      assert.equal(current.started, 1)
      assert.equal(current.earlyClosed, 0,
        'a new mounted cover must remain independent of the old abort')
      assert.equal(current.active, 1)
    } finally {
      if (renderer) await act(async () => renderer.unmount())
    }
  })
})
