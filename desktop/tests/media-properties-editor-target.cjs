const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const projectRequire = createRequire(path.join(repo, 'desktop/package.json'))
const React = projectRequire('react')
const TestRenderer = projectRequire('react-test-renderer')
const material = projectRequire('@mui/material')
const { buildSync } = projectRequire('esbuild')
const { items: golden } = require('../scripts/media-properties-fixtures.cjs')
const output = buildSync({
  entryPoints: [path.join(repo, 'ui/shared/src/mui/MediaGalleryDetails.tsx')], bundle: true,
  packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
}).outputFiles[0].text
const mod = { exports: {} }
new Function('module', 'exports', 'require', output)(mod, mod.exports, name => name.startsWith('@mui/icons-material/') ? projectRequire(name).default : projectRequire(name))
const { XDriveMediaDetailsContent } = mod.exports
const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node)
  : !node || node.type === 'style' ? '' : (node.children || []).map(text).join('')
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }

async function mount(overrides = {}) {
  const calls = []
  const pending = new Map()
  const saveResponse = (field, item, value) => {
    const response = defer()
    calls.push({ field, id: item.node.id, revision: item.node.revision, value })
    pending.set(item.node.id, response)
    return response.promise
  }
  let props = {
    item: structuredClone(golden.still), showPreview: false, albums: [], loadThumbnail: async () => null,
    onSetTags: (item, value) => saveResponse('tags', item, value),
    onSetPeople: (item, value) => saveResponse('people', item, value),
    onSetDescription: (item, value) => saveResponse('description', item, value),
    ...overrides,
  }
  let renderer
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(XDriveMediaDetailsContent, props)); await flush() })
  return {
    calls, pending,
    get text() { return text(renderer.toJSON()) },
    field(label) { return renderer.root.findAllByType(material.TextField).find(node => node.props.label === label) },
    async type(label, value) {
      const input = this.field(label)
      assert.ok(input, 'the actual shared MUI field is present')
      assert.notEqual(input.props.disabled, true, 'the actual shared field is editable')
      await TestRenderer.act(async () => input.props.onChange({ target: { value } }))
    },
    async save(label) {
      const button = renderer.root.findAllByType(material.Button).find(node => text(node) === label)
      assert.ok(button, 'the real field Save control is present')
      assert.notEqual(button.props.disabled, true)
      await TestRenderer.act(async () => { button.props.onClick(); await flush() })
    },
    async update(item) { props = { ...props, item }; await TestRenderer.act(async () => { renderer.update(React.createElement(XDriveMediaDetailsContent, props)); await flush() }) },
    async settle(mode, value, nodeID = 101) {
      const response = pending.get(nodeID)
      assert.ok(response, 'this target owns a real held mutation')
      await TestRenderer.act(async () => { if (mode === 'error') response.reject(new Error('A-save-failed')); else response.resolve(value); await flush() })
    },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

for (const [field, label, save] of [['tags', '标签', '保存标签'], ['people', '人物', '保存人物'], ['description', '描述', '保存描述']]) {
  test(`${field}: late A success cannot replace the current B draft`, async () => {
    const h = await mount()
    try {
      await h.type(label, 'A-draft')
      await h.save(save)
      assert.equal(h.field(label).props.disabled, true)
      await h.update(structuredClone(golden.video))
      await h.type(label, 'B-unsaved-draft')
      await h.settle('success', field === 'description' ? 'A-normalized' : ['A-normalized'])
      assert.match(h.text, new RegExp(golden.video.node.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.deepEqual(h.calls, [{ field, id: 101, revision: 7, value: field === 'description' ? 'A-draft' : ['A-draft'] }])
      assert.equal(h.field(label).props.value, 'B-unsaved-draft')
      assert.equal(h.field(label).props.disabled, false)
      assert.doesNotMatch(h.text, /A-save-failed/)
    } finally { await h.dispose() }
  })

  test(`${field}: an unchanged A accepts the acknowledged normalized result`, async () => {
    const h = await mount()
    try {
      await h.type(label, 'A-draft')
      await h.save(save)
      await h.settle('success', field === 'description' ? 'A-normalized' : ['A-normalized'])
      assert.equal(h.field(label).props.value, 'A-normalized')
      assert.equal(h.field(label).props.disabled, false)
      assert.equal(h.calls.length, 1)
    } finally { await h.dispose() }
  })
}

test('description: rejected A save cannot place its error on the current B', async () => {
  const h = await mount()
  try {
    await h.type('描述', 'A-draft')
    await h.save('保存描述')
    await h.update(structuredClone(golden.video))
    await h.type('描述', 'B-unsaved-draft')
    await h.settle('error')
    assert.equal(h.field('描述').props.value, 'B-unsaved-draft')
    assert.equal(h.field('描述').props.disabled, false)
    assert.deepEqual(h.calls, [{ field: 'description', id: 101, revision: 7, value: 'A-draft' }])
    assert.doesNotMatch(h.text, /A-save-failed/)
  } finally { await h.dispose() }
})

test('description: A completion cannot release B while its own save is still pending', async () => {
  const h = await mount()
  try {
    await h.type('描述', 'A-draft')
    await h.save('保存描述')
    await h.update(structuredClone(golden.video))
    await h.type('描述', 'B-pending-draft')
    await h.save('保存描述')
    assert.equal(h.field('描述').props.disabled, true)
    await h.settle('success', 'A-normalized')
    const observed = { pending: h.field('描述').props.disabled, draft: h.field('描述').props.value }
    await h.settle('success', 'B-normalized', 202)
    assert.deepEqual(observed, { pending: true, draft: 'B-pending-draft' })
    assert.equal(h.field('描述').props.value, 'B-normalized')
    assert.equal(h.field('描述').props.disabled, false)
    assert.deepEqual(h.calls.map(call => call.id), [101, 202])
  } finally { await h.dispose() }
})

test('RAW Properties preview forwards the current revision after the same Node/name updates', async () => {
  const requests = []
  const item = structuredClone(golden.still)
  item.node.name = 'Revision-source.dng'
  item.metadata.mime_type = 'image/x-adobe-dng'
  item.metadata.has_thumbnail = false
  const h = await mount({
    item,
    showPreview: true,
    loadPreviewURL: async (nodeID, kind, signal, fileName, revision) => {
      requests.push({ nodeID, kind, signal, fileName, revision })
      return null
    },
  })
  try {
    assert.deepEqual(requests.map(({ nodeID, fileName, revision }) => ({ nodeID, fileName, revision })), [
      { nodeID: 101, fileName: 'Revision-source.dng', revision: 7 },
    ])
    assert.ok(requests[0].signal instanceof AbortSignal)
    await h.update({ ...item, node: { ...item.node, revision: 8 } })
    assert.deepEqual(requests.map(({ nodeID, fileName, revision }) => ({ nodeID, fileName, revision })), [
      { nodeID: 101, fileName: 'Revision-source.dng', revision: 7 },
      { nodeID: 101, fileName: 'Revision-source.dng', revision: 8 },
    ])
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests[1].signal.aborted, false)
  } finally { await h.dispose() }
})
