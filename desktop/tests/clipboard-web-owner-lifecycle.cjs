'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const sourceFile = path.join(root, 'ui/shared/src/mui/ClipboardPage.tsx')
const source = fs.readFileSync(sourceFile, 'utf8')
const fenceFile = path.join(root, 'ui/shared/src/clipboard-action-fence.ts')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
globalThis.window = { isSecureContext: true, setInterval: () => 1, clearInterval: () => {} }
globalThis.document = { visibilityState: 'visible' }
test.after(() => {
  for (const [name, descriptor] of [['window', originalWindow], ['document', originalDocument]]) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
})

function loadTS(filename, sourceText, injected = {}, jsx = false) {
  const compiled = ts.transpileModule(sourceText, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX },
  })
  assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, request => {
      if (request === 'react') return React
      if (request === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (Object.hasOwn(injected, request)) return injected[request]
      throw new Error('Unexpected Clipboard test dependency: ' + request)
    },
  )
  return module.exports
}
const fence = loadTS(fenceFile, fs.readFileSync(fenceFile, 'utf8'))
function makeUI(
  encrypt = async (_key, _scope, _id, value) => ({
    kind: 'text/plain', nonce: 'nonce', ciphertext: 'cipher:' + value,
  }),
  encryptForDevice = async () => {
    throw Error('Device-targeted envelope not configured in v1-only test')
  },
) {
  // Only MUI's presentational tree is mocked. This executes the real
  // ClipboardPage component, its hooks, effects and click/change handlers.
  const mui = Object.fromEntries(
    ['Alert', 'Box', 'Button', 'Card', 'Divider', 'Stack', 'TextField', 'Typography',
      'MenuItem', 'FormControlLabel', 'Switch']
      .map(name => [name, ({ children, ...props }) => React.createElement(name, props, children)]),
  )
  const crypt = {
    xDriveClipboardDeriveKey: async passphrase => ({ passphrase }),
    xDriveClipboardMakeVaultCheck: async () => ({ nonce: 'check-nonce', ciphertext: 'check-cipher' }),
    xDriveClipboardVerifyVaultCheck: async () => {},
    xDriveClipboardEncrypt: encrypt,
    xDriveClipboardKind: value => /^https?:\/\/\S+$/i.test(value.trim())
      ? 'text/uri-list' : 'text/plain',
    xDriveClipboardDecrypt: async (_key, _scope, item) => 'decrypted:' + item.ciphertext,
    xDriveClipboardValidateText: text => {
      if (!text || Buffer.byteLength(text, 'utf8') > 65536) throw new Error('invalid text')
    },
  }
  return loadTS(sourceFile, source, {
    '@mui/material': mui,
    '../clipboard-crypto': crypt,
    '../clipboard-action-fence': fence,
    '../clipboard-target-crypto': {
      xDriveClipboardEncryptForDevice: encryptForDevice,
    },
    './ClipboardFileNodePicker': { ClipboardFileNodePicker: () => null },
  }, true).XDriveClipboardPage
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function port(scope, extra = {}) {
  return {
    ownerScopeKey: scope,
    vault: async () => ({ salt: 'fixture-salt', kdf: 'PBKDF2-SHA256', iterations: 310000,
      check_nonce: 'check-nonce', check_ciphertext: 'check-cipher', aad_scope: scope }),
    initializeCheck: async proof => ({ salt: 'fixture-salt', kdf: 'PBKDF2-SHA256',
      iterations: 310000, check_nonce: proof.nonce, check_ciphertext: proof.ciphertext, aad_scope: proof.scope }),
    list: async () => ({ items: [], next_before: null }),
    create: async item => ({ id: 1, ...item }),
    remove: async () => {},
    clear: async () => {},
    readText: async () => 'clipboard text',
    copyText: async () => {},
    ...extra,
  }
}
async function act(fn) {
  await Renderer.act(async () => { fn(); await Promise.resolve() })
}
async function mount(Page, owner) {
  let renderer
  await act(() => { renderer = Renderer.create(React.createElement(Page, { port: owner })) })
  return {
    renderer,
    update: next => act(() => renderer.update(React.createElement(Page, { port: next }))),
    unmount: () => act(() => renderer.unmount()),
    button(label) {
      const button = renderer.root.findAllByType('Button')
        .find(item => item.props.children === label)
      assert.ok(button, 'expected actual Clipboard button: ' + label)
      return button
    },
    field(label) {
      const field = renderer.root.findAllByType('TextField')
        .find(item => item.props.label === label)
      assert.ok(field, 'expected actual Clipboard field: ' + label)
      return field
    },
    snapshot: () => JSON.stringify(renderer.toJSON()),
  }
}
const click = (app, label) => act(() => app.button(label).props.onClick())
const type = (app, label, value) => act(() =>
  app.field(label).props.onChange({ target: { value } }))
async function unlock(app) {
  await type(app, '剪贴板口令', 'correct long test passphrase')
  await click(app, '解锁')
  assert.ok(app.button('锁定'))
}

test('Clipboard React mounts A→B→A with fresh vault and discards late A unlock', async () => {
  const Page = makeUI()
  const oldVault = deferred()
  let oldLoads = 0
  const a = port('https://drive.example:1', {
    vault: () => oldVault.promise,
    list: async () => { oldLoads++; return { items: [], next_before: null } },
  })
  const b = port('https://drive.example:2')
  const app = await mount(Page, a)
  await type(app, '剪贴板口令', 'correct long test passphrase')
  await click(app, '解锁') // unresolved A vault request
  await app.update(b) // should unmount A and revoke A's action fence
  oldVault.resolve(await port(a.ownerScopeKey).vault())
  await act(() => {})
  assert.equal(oldLoads, 0)
  assert.ok(app.button('解锁'), 'B must not inherit A key or plaintext')
  await unlock(app)
  await app.update(a)
  assert.ok(app.button('解锁'), 'A→B→A must require a new explicit unlock')
  await app.unmount()
})

test('Clipboard React lock and unmount discard a late OS clipboard permission result', async () => {
  const read = deferred()
  const app = await mount(makeUI(), port('https://drive.example:3', {
    readText: () => read.promise,
  }))
  await unlock(app)
  await type(app, '输入内容', 'my private draft')
  await click(app, '从系统剪贴板读取')
  await click(app, '锁定')
  read.resolve('obsolete secret text')
  await act(() => {})
  assert.ok(app.button('解锁'))
  assert.doesNotMatch(app.snapshot(), /obsolete secret text|my private draft/)
  await app.unmount()
})

test('Clipboard React lock prevents late copy success/error from replacing lock status', async () => {
  const copying = deferred()
  const records = [{ id: 7, kind: 'text/plain', client_event_id: 'event-7',
    nonce: 'nonce', ciphertext: 'known-secret', created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 50000).toISOString() }]
  const app = await mount(makeUI(), port('https://drive.example:4', {
    list: async () => ({ items: records, next_before: null }),
    copyText: () => copying.promise,
  }))
  await unlock(app)
  await click(app, '复制到本机')
  await click(app, '锁定')
  copying.resolve()
  await act(() => {})
  assert.match(app.snapshot(), /剪贴板已锁定/)
  assert.doesNotMatch(app.snapshot(), /已复制到本机|known-secret/)
  await app.unmount()
})

test('Clipboard React reports an OS copy denial without claiming success', async () => {
  const item = { id: 9, kind: 'text/plain', client_event_id: 'event-9',
    nonce: 'nonce', ciphertext: 'copy-me', created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 50000).toISOString() }
  const app = await mount(makeUI(), port('https://drive.example:4-copy', {
    list: async () => ({ items: [item], next_before: null }),
    copyText: async () => { throw new Error('NotAllowedError') },
  }))
  await unlock(app)
  await click(app, '复制到本机')
  assert.match(app.snapshot(), /NotAllowedError/)
  assert.doesNotMatch(app.snapshot(), /已复制到本机/)
  await app.unmount()
})

test('Clipboard React unknown ACK retry preserves encrypted bytes and EventID', async () => {
  const saved = []
  const app = await mount(makeUI(), port('https://drive.example:5', {
    create: async item => {
      saved.push({ ...item })
      if (saved.length === 1) throw new Error('simulated lost ACK after server write')
      return { id: 31, ...item }
    },
  }))
  await unlock(app)
  await type(app, '输入内容', 'same payload')
  await click(app, '加密发送')
  assert.match(app.snapshot(), /发送未确认/)
  await click(app, '加密发送')
  assert.equal(saved.length, 2)
  assert.deepEqual(saved[1], saved[0], 'retry must never re-encrypt unknown ACK')
  assert.equal(app.field('输入内容').props.value, '')
  await app.unmount()
})


test('Clipboard React does not replace an unknown-ACK receipt after editing the draft', async () => {
  const saved = []
  const app = await mount(makeUI(), port('https://drive.example:57', {
    create: async item => {
      saved.push({ ...item })
      if (saved.length === 1) throw new Error('lost ACK after server commit')
      return { id: 57, ...item }
    },
  }))
  try {
    await unlock(app)
    await type(app, '输入内容', 'original uncertain payload')
    await click(app, '加密发送')
    assert.equal(saved.length, 1)
    await type(app, '输入内容', 'new draft must not lose first receipt')
    await click(app, '加密发送')
    assert.equal(saved.length, 1, 'a new draft must not replace a pending unknown ACK')
    assert.match(app.snapshot(), /上一条发送回执仍未确认/)
    assert.ok(app.button('放弃待确认回执'))
    // Returning to the original draft can retry the same encrypted receipt.
    await type(app, '输入内容', 'original uncertain payload')
    await click(app, '加密发送')
    assert.equal(saved.length, 2)
    assert.deepEqual(saved[1], saved[0], 'editing and restoring must preserve the original EventID')
  } finally {
    await app.unmount()
  }
})

test('Clipboard React requires explicit abandon before sending a different draft', async () => {
  const saved = []
  const app = await mount(makeUI(), port('https://drive.example:58', {
    create: async item => {
      saved.push({ ...item })
      if (saved.length === 1) throw new Error('lost ACK after server commit')
      return { id: 58, ...item }
    },
  }))
  try {
    await unlock(app)
    await type(app, '输入内容', 'first payload with lost ACK')
    await click(app, '加密发送')
    await type(app, '输入内容', 'second payload after lost ACK')
    await click(app, '加密发送')
    assert.equal(saved.length, 1, 'unknown-ACK receipt must not be overwritten')
    await click(app, '放弃待确认回执')
    assert.match(app.snapshot(), /已放弃旧回执/)
    await click(app, '加密发送')
    assert.equal(saved.length, 2)
    assert.notEqual(saved[1].client_event_id, saved[0].client_event_id,
      'an explicitly abandoned event must not be silently replayed')
    assert.equal(saved[1].ciphertext, 'cipher:second payload after lost ACK')
  } finally {
    await app.unmount()
  }
})

test('Clipboard React blocks stale unknown ACK retries until explicitly abandoned', async () => {
  const realNow = Date.now
  let clock = realNow()
  const sent = []
  const app = await mount(makeUI(), port('https://drive.example:55', {
    create: async item => {
      sent.push({ ...item })
      if (sent.length === 1) throw new Error('simulated unknown ACK')
      return { id: 55, ...item }
    },
  }))
  try {
    Date.now = () => clock
    await unlock(app)
    await type(app, '输入内容', 'an uncertain long-lived message')
    await click(app, '加密发送')
    assert.equal(sent.length, 1)
    clock += 5 * 60 * 1000
    await click(app, '加密发送')
    assert.equal(sent.length, 1, 'expired pending payload must never be replayed')
    assert.match(app.snapshot(), /待确认回执已超过安全重试期限/)
    await click(app, '放弃过期重试')
    assert.match(app.snapshot(), /已放弃旧回执/)
    await click(app, '加密发送')
    assert.equal(sent.length, 2)
    assert.notEqual(sent[0].client_event_id, sent[1].client_event_id,
      'new send after explicit abandon must receive a fresh EventID')
  } finally {
    Date.now = realNow
    await app.unmount()
  }
})

test('Clipboard React rejects unknown ACK retry after local clock rollback', async () => {
  const realNow = Date.now
  let clock = realNow()
  let submitted = 0
  const app = await mount(makeUI(), port('https://drive.example:56', {
    create: async () => { submitted++; throw new Error('lost ACK') },
  }))
  try {
    Date.now = () => clock
    await unlock(app)
    await type(app, '输入内容', 'do not retry after clock rollback')
    await click(app, '加密发送')
    clock -= 1000
    await click(app, '加密发送')
    assert.equal(submitted, 1, 'clock rollback must not enable repeated writes')
    assert.match(app.snapshot(), /待确认回执已超过安全重试期限/)
  } finally {
    Date.now = realNow
    await app.unmount()
  }
})

test('Clipboard React preserves newer draft after delayed ACK, and drops post-lock encryption', async () => {
  const ack = deferred()
  const app = await mount(makeUI(), port('https://drive.example:6', {
    create: () => ack.promise,
  }))
  await unlock(app)
  await type(app, '输入内容', 'draft before send')
  await click(app, '加密发送')
  await type(app, '输入内容', 'newer draft while request is in flight')
  ack.resolve({ id: 11 })
  await act(() => {})
  assert.equal(app.field('输入内容').props.value, 'newer draft while request is in flight')
  await app.unmount()

  const cipher = deferred()
  let submitted = 0
  const other = await mount(makeUI(() => cipher.promise), port('https://drive.example:7', {
    create: async () => { submitted++; return { id: 8 } },
  }))
  await unlock(other)
  await type(other, '输入内容', 'old secret')
  await click(other, '加密发送')
  await click(other, '锁定')
  cipher.resolve({ kind: 'text/plain', nonce: 'n', ciphertext: 'c' })
  await act(() => {})
  assert.equal(submitted, 0, 'late crypto completion must not start a Server write')
  assert.doesNotMatch(other.snapshot(), /old secret/)
  await other.unmount()
})

test('Clipboard React permission rejection keeps manual input and shows failure', async () => {
  const app = await mount(makeUI(), port('https://drive.example:8', {
    readText: async () => { throw new Error('NotAllowedError') },
  }))
  await unlock(app)
  await type(app, '输入内容', 'manual text remains')
  await click(app, '从系统剪贴板读取')
  assert.equal(app.field('输入内容').props.value, 'manual text remains')
  assert.match(app.snapshot(), /浏览器未允许读取剪贴板/)
  await app.unmount()
})

test('Browser Clipboard port rejects insecure and missing readText contexts', async () => {
  const file = path.join(root, 'web/src/clipboardDataPort.ts')
  const { createXDriveWebClipboardPort } = loadTS(file, fs.readFileSync(file, 'utf8'), {
    './browserClipboard': { xDriveBrowserCopyText: async () => {} },
  })
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    let calls = 0
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { clipboard: { readText: async () => { calls++; return 'private' } } } })
    const api = {}
    const runtimePort = createXDriveWebClipboardPort(api, 'https://drive.example:8')
    globalThis.window.isSecureContext = false
    await assert.rejects(runtimePort.readText(), /浏览器不允许读取系统剪贴板/)
    assert.equal(calls, 0, 'insecure context must not access OS clipboard')
    globalThis.window.isSecureContext = true
    assert.equal(await runtimePort.readText(), 'private')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    await assert.rejects(runtimePort.readText(), /浏览器不允许读取系统剪贴板/)
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { clipboard: { readText: async () => { throw new Error('NotAllowedError') } } } })
    await assert.rejects(runtimePort.readText(), /NotAllowedError/)
  } finally {
    globalThis.window.isSecureContext = true
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator)
    else delete globalThis.navigator
  }
})

test('Clipboard directed Node retry cannot reuse an unknown ACK with a changed MIME kind', async () => {
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const publicKey = Buffer.alloc(32, 7).toString('base64')
  const records = []
  const encryptedKinds = []
  const Page = makeUI(undefined, async (_scope, target, _pub, _event, kind, text, nodeID) => {
    encryptedKinds.push(kind)
    assert.equal(target, deviceID)
    assert.equal(nodeID, 118)
    assert.equal(text, 'asset:118')
    return {
      kind, target_device_id: target,
      ephemeral_key: Buffer.alloc(32, 8).toString('base64'),
      wrapped_key: Buffer.alloc(60, 9).toString('base64'),
      node_id: nodeID, nonce: 'target-nonce', ciphertext: 'sealed:' + kind,
    }
  })
  const app = await mount(Page, port('https://drive.example:directed-owner', {
    listDevices: async () => ({ devices: [
      { device_id: deviceID, name: 'Verified iPhone', platform: 'ios', public_key: publicKey },
    ] }),
    create: async item => {
      records.push({ ...item })
      if (records.length === 1) throw Error('lost ACK after directed commit')
      return { id: 118, ...item }
    },
  }))
  try {
    await unlock(app)
    await act(() => {})
    await type(app, '发送范围', deviceID)
    await type(app, '内容类型', 'image')
    await type(app, '已上传的云端文件 ID', '118')
    await click(app, '加密发送')
    assert.equal(records.length, 1)
    assert.equal(records[0].kind, 'image/x-xdrive-node-ref')
    assert.match(app.snapshot(), /发送未确认/)

    // Only the requested MIME kind changed. The Node and target stayed fixed.
    await type(app, '内容类型', 'file')
    assert.equal(app.field('已上传的云端文件 ID').props.value, '',
      'media kind change invalidates the old Node choice')
    await type(app, '已上传的云端文件 ID', '118')
    await click(app, '加密发送')
    assert.equal(records.length, 1, 'must not send old image ciphertext under new file intent')
    assert.equal(encryptedKinds.length, 1, 'must not silently create a new EventID after unknown ACK')
    assert.match(app.snapshot(), /上一条发送回执仍未确认/)

    // Restore the exact original intent; only then retry identical bytes/ID.
    await type(app, '内容类型', 'image')
    assert.equal(app.field('已上传的云端文件 ID').props.value, '')
    await type(app, '已上传的云端文件 ID', '118')
    await click(app, '加密发送')
    assert.equal(records.length, 2)
    assert.deepEqual(records[1], records[0], 'safe retry preserves exact authenticated kind and EventID')
    assert.deepEqual(encryptedKinds, ['image/x-xdrive-node-ref'])
  } finally {
    await app.unmount()
  }
})

test('Clipboard switches image/file kind only after a fresh Node choice, never auto-sends', async () => {
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const submissions = []
  const encrypted = []
  const Page = makeUI(undefined, async (_scope, target, _pub, _event, kind, clear, nodeID) => {
    encrypted.push({target, kind, clear, nodeID})
    return {
      kind, target_device_id: target, node_id: nodeID,
      ephemeral_key: Buffer.alloc(32, 8).toString('base64'),
      wrapped_key: Buffer.alloc(60, 9).toString('base64'),
      nonce: 'nonce', ciphertext: 'sealed:' + kind,
    }
  })
  const app = await mount(Page, port('https://drive.example:kind-bound-owner', {
    listDevices: async () => ({ devices: [{
      device_id: deviceID, name: 'Authorized iPhone', platform: 'ios',
      public_key: Buffer.alloc(32, 7).toString('base64'),
    }] }),
    create: async item => { submissions.push({...item}); return {id: 119, ...item} },
  }))
  try {
    await unlock(app)
    await act(() => {})
    await type(app, '发送范围', deviceID)
    await type(app, '内容类型', 'image')
    await type(app, '已上传的云端文件 ID', '118')
    await type(app, '内容类型', 'file')
    assert.equal(app.field('已上传的云端文件 ID').props.value, '',
      'old image Node must not carry into file MIME selection')
    assert.equal(app.button('加密发送').props.disabled, true)
    assert.equal(submissions.length, 0)
    await type(app, '已上传的云端文件 ID', '119')
    await click(app, '加密发送')
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].kind, 'application/x-xdrive-node-ref')
    assert.equal(submissions[0].node_id, 119)
    assert.deepEqual(encrypted, [{
      target: deviceID, kind: 'application/x-xdrive-node-ref',
      clear: 'asset:119', nodeID: 119,
    }])
    await type(app, '内容类型', 'image')
    assert.equal(app.field('已上传的云端文件 ID').props.value, '',
      'new MIME selection must require another explicit Node choice')
    assert.equal(app.button('加密发送').props.disabled, true)
    assert.equal(submissions.length, 1, 'type changes never send by themselves')
  } finally {
    await app.unmount()
  }
})

test('Clipboard PNG CAS receipt is not sent until a separate user confirmation', async () => {
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const publicKey = Buffer.alloc(32, 7).toString('base64')
  const submitted = []
  let imports = 0
  const Page = makeUI(undefined, async (_scope, target, _pub, _event, kind, clear, nodeID) => {
    assert.equal(target, deviceID)
    assert.equal(kind, 'image/x-xdrive-node-ref')
    assert.equal(nodeID, 118)
    assert.equal(clear, 'asset:118')
    return {
      kind, target_device_id: target, node_id: nodeID,
      ephemeral_key: Buffer.alloc(32, 8).toString('base64'),
      wrapped_key: Buffer.alloc(60, 9).toString('base64'),
      nonce: 'nonce', ciphertext: 'encrypted-node-only',
    }
  })
  const app = await mount(Page, port('https://drive.example:verified-cas-owner', {
    listDevices: async () => ({ devices: [
      { device_id: deviceID, name: 'Verified iPhone', platform: 'ios', public_key: publicKey },
    ] }),
    importImageFromClipboard: async signal => {
      assert.equal(signal.aborted, false)
      imports++
      return { node_id: 118 }
    },
    uploadLocalFile: async () => { throw Error('wrong import path') },
    create: async item => { submitted.push({ ...item }); return { id: 46, ...item } },
  }))
  try {
    await unlock(app)
    await act(() => {})
    await type(app, '发送范围', deviceID)
    await type(app, '内容类型', 'image')
    await click(app, '读取本机剪贴板图片并上传')
    assert.equal(imports, 1)
    assert.equal(app.field('已上传的云端文件 ID').props.value, '118')
    assert.equal(submitted.length, 0, 'upload is NOT an implicit encrypted send')
    assert.match(app.snapshot(), /请检查文件，然后明确点击/)
    await click(app, '加密发送')
    assert.equal(submitted.length, 1)
    assert.equal(submitted[0].kind, 'image/x-xdrive-node-ref')
    assert.equal(submitted[0].target_device_id, deviceID)
    assert.equal(submitted[0].node_id, 118)
  } finally {
    await app.unmount()
  }
})

test('Clipboard import resolved after Lock cannot restore a stale CAS Node or automatically send', async () => {
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const selected = deferred()
  const submitted = []
  let imports = 0
  const app = await mount(makeUI(), port('https://drive.example:retired-cas-owner', {
    listDevices: async () => ({ devices: [
      { device_id: deviceID, name: 'iPhone', platform: 'ios',
        public_key: Buffer.alloc(32, 7).toString('base64') },
    ] }),
    importImageFromClipboard: signal => {
      imports++
      assert.equal(signal.aborted, false)
      return selected.promise
    },
    create: async item => { submitted.push(item); return { id: 46, ...item } },
  }))
  try {
    await unlock(app)
    await act(() => {})
    await type(app, '发送范围', deviceID)
    await type(app, '内容类型', 'image')
    await click(app, '读取本机剪贴板图片并上传')
    assert.equal(imports, 1)
    await click(app, '锁定')
    selected.resolve({ node_id: 118 })
    await act(() => {})
    assert.ok(app.button('解锁'), 'Lock keeps user in locked state')
    assert.doesNotMatch(app.snapshot(), /asset:118|已上传到当前 Owner/)
    assert.equal(submitted.length, 0)
  } finally {
    await app.unmount()
  }
})

test('Clipboard React targeted Node reads use exact server item ID and reject wrong decrypted Node', async () => {
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const record = {
    id: 78, client_event_id: '5f0d0c4b-c7b4-46d1-b068-dfd81b1794f7',
    kind: 'application/x-xdrive-node-ref', target_device_id: deviceID, node_id: 118,
    nonce: 'nonce', ciphertext: 'ciphertext',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 40000).toISOString(),
  }
  const asked = []
  const app = await mount(makeUI(), port('https://drive.example:target-owner', {
    list: async () => ({items:[record],next_before:null}),
    decryptTarget: async (id, signal) => {
      asked.push(id)
      assert.equal(signal.aborted,false)
      return 'asset:119' // valid E2EE of another Node must never be shown as this Node
    },
  }))
  try {
    await unlock(app)
    await act(() => {})
    assert.ok(asked.includes(78),'only server item ID may enter narrow Agent decrypt API')
    assert.match(app.snapshot(), /无法解密/)
    assert.doesNotMatch(app.snapshot(), /asset:119|剪贴板明文（仅在此页面内解密）/)
  } finally {
    await app.unmount()
  }
})

test('Clipboard React Lock discards delayed device decrypt and A→B→A cannot revive it', async () => {
  const pendingDecrypt = deferred()
  const deviceID = 'a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
  const record = {
    id: 79, client_event_id: '5f0d0c4b-c7b4-46d1-b068-dfd81b1794f7',
    kind: 'image/x-xdrive-node-ref', target_device_id: deviceID, node_id: 118,
    nonce: 'nonce', ciphertext: 'ciphertext',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 40000).toISOString(),
  }
  let callCount = 0
  const a = port('https://drive.example:owner-a', {
    list: async()=>({items:[record],next_before:null}),
    decryptTarget: async()=>{callCount++;return pendingDecrypt.promise},
  })
  const b = port('https://drive.example:owner-b')
  const app = await mount(makeUI(), a)
  try {
    await unlock(app)
    assert.ok(callCount>0,'device-targeted decrypt must start for current Owner')
    await click(app,'锁定')
    await app.update(b)
    await app.update(a)
    pendingDecrypt.resolve('asset:118')
    await act(()=>{})
    assert.ok(app.button('解锁'),'Owner A after B must start locked')
    assert.doesNotMatch(app.snapshot(),/asset:118|剪贴板明文（仅在此页面内解密）/)
  } finally {
    await app.unmount()
  }
})
