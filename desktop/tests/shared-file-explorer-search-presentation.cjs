const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Exercise the production formatter and menu callbacks. The command-button
// import is unrelated to menu construction; keep the parent-owned Explorer UI
// outside this unit boundary.
function load(relativePath) {
  const filename = path.join(__dirname, '../../ui/shared/src', relativePath)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const compiled = { exports: {} }
  new Function('module', 'exports', 'require', output)(compiled, compiled.exports, (name) => {
    if (name === './FileExplorer') return { XDriveFileExplorerCommandButton: () => null }
    return require(name)
  })
  return compiled.exports
}

const search = load('file-explorer-search.ts')
const { xDriveFileExplorerStandardItemMenuItems: menuItems } = load('mui/FileExplorerActions.tsx')
const labels = (filters, options) => {
  assert.equal(typeof search.xDriveFileExplorerSearchFilterLabels, 'function',
    'the shared search model must export readable active filter labels')
  return search.xDriveFileExplorerSearchFilterLabels(filters, options)
}

test('an empty filter summary stays empty, including explicitly cleared fields', () => {
  for (const filters of [undefined, null, {}, {
    kind: undefined, modifiedFrom: '', modifiedTo: '', minSize: undefined,
    maxSize: undefined, sourceID: 0, tagID: 0, availability: undefined,
  }]) assert.deepEqual(labels(filters), [])
})

test('active summary names every condition without truncating source or tag labels', () => {
  const sourceName = '项目同步 / 嵌套目录 / '.repeat(12) + 'final'
  const tagName = '很长的旅行标签 <原图> & family 🧭 '.repeat(12)
  const filters = Object.freeze({
    kind: 'image', modifiedFrom: '2026-10-01T00:00:00Z', modifiedTo: '2026-10-09T00:00:00Z',
    minSize: 1234, maxSize: 5678, availability: 'online-only', sourceID: 7, tagID: 9,
  })
  const options = Object.freeze({
    sourceOptions: Object.freeze([{ id: 7, name: sourceName }]),
    tagOptions: Object.freeze([{ id: 9, name: tagName }]),
    availabilityOptions: Object.freeze([{ value: 'online-only', label: '仅联机' }]),
  })
  assert.deepEqual(labels(filters, options), [
    '类型：图片',
    `修改时间：起 ${new Date(filters.modifiedFrom).toLocaleString()} · 止 ${new Date(filters.modifiedTo).toLocaleString()}`,
    `大小：至少 ${(1234).toLocaleString()} 字节 · 至多 ${(5678).toLocaleString()} 字节`,
    '可用性：仅联机',
    `同步文件夹：${sourceName}`,
    `标签：${tagName}`,
  ])
  assert.equal(search.xDriveFileExplorerSearchFilterCount(filters), 6)
})

test('missing options preserve active IDs and raw availability instead of hiding conditions', () => {
  const filters = { sourceID: 71, tagID: 91, availability: 'cloud' }
  assert.deepEqual(labels(filters, {
    sourceOptions: [{ id: 7, name: '其他同步文件夹' }],
    tagOptions: [], availabilityOptions: [],
  }), ['可用性：cloud', '同步文件夹：71', '标签：91'])
  assert.deepEqual(labels(filters, {
    sourceOptions: [{ id: 71, name: '' }], tagOptions: [{ id: 91, name: '' }],
    availabilityOptions: [{ value: 'cloud', label: '' }],
  }), ['可用性：', '同步文件夹：', '标签：'], 'retain the existing nullish-name fallback semantics')
})

test('modified bounds retain their exact values, including saved invalid text and one-sided bounds', () => {
  assert.deepEqual(labels({ modifiedFrom: 'saved-unparsed-bound' }), ['修改时间：起 saved-unparsed-bound'])
  const upper = '2026-01-01T12:34:56Z'
  assert.deepEqual(labels({ modifiedTo: upper }), [`修改时间：止 ${new Date(upper).toLocaleString()}`])
})

test('size presets keep their labels while custom and zero bounds remain readable', () => {
  const mib = 1024 * 1024
  const gib = 1024 * mib
  const cases = [
    [{ minSize: 0, maxSize: mib - 1 }, '大小：< 1 MiB'],
    [{ minSize: mib, maxSize: 100 * mib - 1 }, '大小：1–100 MiB'],
    [{ minSize: 100 * mib, maxSize: gib - 1 }, '大小：100 MiB–1 GiB'],
    [{ minSize: gib }, '大小：≥ 1 GiB'],
    [{ minSize: 0 }, '大小：至少 0 字节'],
    [{ maxSize: 0 }, '大小：至多 0 字节'],
    [{ minSize: 1, maxSize: 1 }, '大小：至少 1 字节 · 至多 1 字节'],
  ]
  for (const [filters, expected] of cases) assert.deepEqual(labels(filters), [expected])
})

test('all existing kind labels remain available to active summaries', () => {
  const expected = {
    folder: '文件夹', file: '全部文件', image: '图片', video: '视频', audio: '音频', pdf: 'PDF',
    document: '文档', spreadsheet: '表格', presentation: '演示文稿', archive: '压缩文件',
    code: '代码', text: '文本', other: '其他文件',
  }
  for (const [kind, label] of Object.entries(expected)) assert.deepEqual(labels({ kind }), [`类型：${label}`])
})

for (const kind of ['file', 'dir']) {
  test(`${kind} search result can show its containing folder independently of native reveal`, () => {
    const selected = []
    const items = menuItems({
      kind,
      onOpen: () => selected.push('open'),
      onShowContainingFolder: () => selected.push('containing'),
      onReveal: () => selected.push('native'),
      revealLabel: '在系统文件管理器中显示',
      onDelete: () => selected.push('delete'),
    })
    const containing = items.filter((item) => item.id === 'show-containing-folder')
    assert.equal(containing.length, 1)
    assert.equal(containing[0].label, '显示所在文件夹')
    assert.equal(containing[0].disabled, false)
    containing[0].onSelect()
    assert.deepEqual(selected, ['containing'])
    const native = items.find((item) => item.id === 'reveal')
    assert.equal(native.label, '在系统文件管理器中显示')
    native.onSelect()
    items.find((item) => item.id === 'open').onSelect()
    assert.deepEqual(selected, ['containing', 'native', 'open'])
  })
}

test('containing-folder navigation is opt-in and observes the shared primary busy gate', () => {
  for (const kind of ['file', 'dir']) {
    assert.ok(!menuItems({ kind, onReveal() {}, onDelete() {} })
      .some((item) => item.id === 'show-containing-folder'))
    const items = menuItems({ kind, primaryDisabled: true, onShowContainingFolder() {}, onDelete() {} })
    assert.equal(items.find((item) => item.id === 'show-containing-folder')?.disabled, true)
    assert.equal(items.at(-1).id, 'delete')
  }
})
