'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaSafeReadRetry.ts'), 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'pwaSafeReadRetry.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const readPath = '/api/v1/nodes/42/children?range=true'

function browserWithVisibility(visibility) {
  const browserDocument = {}
  Object.defineProperty(browserDocument, 'visibilityState', {
    get() {
      if (visibility === 'denied') throw new Error('SecurityError: Safari visibilityState getter denied')
      return visibility
    },
  })
  const exported = {}
  new Function('exports', 'document', 'fetch', 'DOMException', code)(
    exported, browserDocument, async () => { throw Error('unexpected implicit fetch') }, DOMException,
  )
  return exported.xDriveFetchPwaSafeRead
}

function response(status) {
  return { status, headers: { get: name => name === 'Retry-After' ? '0' : null } }
}

test('Safari denied visibility getter preserves successful and error HTTP responses without a second GET', async () => {
  const read = browserWithVisibility('denied')
  for (const status of [200, 401, 429, 503]) {
    const original = response(status)
    let count = 0
    const returned = await read(readPath, readPath, {}, async () => {
      count += 1
      return original
    })
    assert.strictEqual(returned, original, 'already received HTTP response must remain readable')
    assert.equal(count, 1, 'unknown foreground status must not authorize a retry')
  }
})

test('Safari denied visibility getter retains the original network error with one request', async () => {
  const read = browserWithVisibility('denied')
  const offline = new TypeError('fetch failed')
  let count = 0
  await assert.rejects(read(readPath, readPath, {}, async () => {
    count += 1
    throw offline
  }), error => error === offline)
  assert.equal(count, 1, 'no speculative retry when Safari foreground state is unknown')
})

test('already aborted request never issues a GET even if Safari visibility is denied', async () => {
  const read = browserWithVisibility('denied')
  const controller = new AbortController()
  controller.abort()
  let count = 0
  await assert.rejects(read(readPath, readPath, { signal: controller.signal }, async () => {
    count += 1
    return response(200)
  }), { name: 'AbortError' })
  assert.equal(count, 0)
})

test('visible browser still performs exactly one bounded safe 503 retry', async () => {
  const read = browserWithVisibility('visible')
  let count = 0
  const result = await read(readPath, readPath, {}, async () => {
    count += 1
    return response(count === 1 ? 503 : 200)
  })
  assert.equal(result.status, 200)
  assert.equal(count, 2)
})
