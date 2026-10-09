const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const projectRequire = createRequire(path.join(repo, 'desktop/package.json'))
const React = projectRequire('react')
const TestRenderer = projectRequire('react-test-renderer')
const material = projectRequire('@mui/material')
const { items: goldens } = require('../scripts/media-properties-fixtures.cjs')
const code = projectRequire('esbuild').buildSync({
  entryPoints: [path.join(repo, 'ui/shared/src/mui/MediaGalleryDetails.tsx')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs',
  jsx: 'automatic', write: false, logLevel: 'silent',
}).outputFiles[0].text
const moduleValue = { exports: {} }
new Function('module', 'exports', 'require', code)(moduleValue, moduleValue.exports, name => name.startsWith('@mui/icons-material/') ? projectRequire(name).default : projectRequire(name))
const { xDriveMediaInspectorFields, XDriveMediaDetailsContent } = moduleValue.exports

for (const current of [
  { name: 'Explicit top-level zero remains known 0 degrees', metadata: { rotation_degrees: 0 }, expected: '0°' },
  { name: 'Explicit top-level nonzero remains known 90 degrees', metadata: { rotation_degrees: 90 }, expected: '90°' },
  { name: 'Omitted top-level zero uses existing VideoJSON rotation zero', metadata: { video: { rotation_degrees: 0, video_codec: 'avc1' } }, expected: '0°' },
  { name: 'Rotation absent from both top-level and video is unrecorded', metadata: {}, expected: '未记录' },
  { name: 'Legacy WebM metadata without rotation does not imply zero', metadata: { video: { container: 'webm', video_codec: 'V_VP9', tracks: [] } }, expected: '未记录' },
]) {
  test(current.name, () => {
    const item = structuredClone(goldens.video)
    delete item.metadata.rotation_degrees
    delete item.metadata.video
    Object.assign(item.metadata, current.metadata)
    assert.equal(xDriveMediaInspectorFields(item).photoInfo.find(([label]) => label === '视频旋转')?.[1], current.expected)
  })
}

const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node)
  : !node || node.type === 'style' ? '' : (node.children || []).map(text).join('')
const flush = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve() }

async function mount() {
  const calls = []
  let held
  const mutation = (field, item, value) => {
    calls.push({ field, id: item.node.id, value })
    return new Promise((resolve, reject) => { held = { resolve, reject } })
  }
  let props = {
    item: structuredClone(goldens.still), showPreview: false, albums: [], loadThumbnail: async () => null,
    onSetTags: (item, value) => mutation('tags', item, value),
    onSetPeople: (item, value) => mutation('people', item, value),
    onSetDescription: (item, value) => mutation('description', item, value),
  }
  let renderer
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(XDriveMediaDetailsContent, props)); await flush() })
  return {
    calls,
    input(label) { return renderer.root.findAllByType(material.TextField).find(node => node.props.label === label) },
    saveButton(label) { return renderer.root.findAllByType(material.Button).find(node => text(node) === `保存${label}`) },
    get statuses() { return renderer.root.findAllByType(material.Typography).filter(node => node.props.role === 'status').map(node => ({ text: text(node), live: node.props['aria-live'] })) },
    get text() { return text(renderer.toJSON()) },
    async type(label, value) { await TestRenderer.act(async () => { this.input(label).props.onChange({ target: { value } }); await flush() }) },
    async save(label) { await TestRenderer.act(async () => { this.saveButton(label).props.onClick(); await flush() }) },
    async settle(value, error = false) {
      const response = held
      assert.ok(response, 'an existing callback owns this response')
      held = null
      await TestRenderer.act(async () => { if (error) response.reject(new Error('Server refused this draft')); else response.resolve(value); await flush() })
    },
    async acknowledge(field, value) {
      props = { ...props, item: { ...props.item, [field]: value } }
      await TestRenderer.act(async () => { renderer.update(React.createElement(XDriveMediaDetailsContent, props)); await flush() })
    },
    async replaceTarget() {
      props = { ...props, item: structuredClone(goldens.video) }
      await TestRenderer.act(async () => { renderer.update(React.createElement(XDriveMediaDetailsContent, props)); await flush() })
    },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

for (const [field, label] of [['tags', '标签'], ['people', '人物'], ['description', '描述']]) {
  test(`${field}: meaningful polite feedback follows saving, normalization, next edit and retry`, async () => {
    const h = await mount()
    const failed = []
    const record = (name, passed) => { if (!passed) failed.push(name) }
    const hasStatus = pattern => h.statuses.some(status => status.live === 'polite' && pattern.test(status.text))
    const value = field === 'description' ? 'Accepted value' : ['Accepted value']
    try {
      record('pristine target has no saved acknowledgment', !hasStatus(/已保存/))
      await h.type(label, 'First draft')
      await h.save(label)
      record('saving has nonempty polite text', hasStatus(new RegExp(`正在保存${label}`)))
      record('saving retains the existing disabled controls', h.input(label).props.disabled && h.saveButton(label).props.disabled)
      await h.settle(value)
      record('accepted result has a saved acknowledgment', hasStatus(new RegExp(`${label}已保存`)))
      record('normalization is retained', h.input(label).props.value === 'Accepted value')
      await h.acknowledge(field, value)
      record('parent normalized update retains saved acknowledgment', hasStatus(new RegExp(`${label}已保存`)))
      await h.type(label, 'Next local draft')
      record('next edit replaces saved with unsaved feedback', !hasStatus(/已保存/) && hasStatus(/未保存/))
      record('editing alone creates no request', h.calls.length === 1)
      await h.save(label)
      await h.settle(null, true)
      record('rejection preserves draft and retry', h.input(label).props.value === 'Next local draft' && !h.saveButton(label).props.disabled && /Server refused this draft/.test(h.text))
      record('rejection has no saved acknowledgment', !hasStatus(/已保存/))
      await h.save(label)
      await h.settle(value)
      record('retry acknowledges success and clears the actual error', hasStatus(new RegExp(`${label}已保存`)) && !/Server refused this draft/.test(h.text))
      await h.replaceTarget()
      record('new displayed target inherits no prior editor feedback', !hasStatus(/已保存|正在保存|未保存/))
      assert.deepEqual(failed, [])
    } finally { await h.dispose() }
  })
}
