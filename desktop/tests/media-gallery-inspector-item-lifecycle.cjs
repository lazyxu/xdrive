const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const mui = {
  Box: 'box', Button: 'button', MenuItem: 'menuitem', Stack: 'stack',
  TextField: 'input', Typography: 'typography', Drawer: 'drawer',
  IconButton: 'icon-button', Paper: 'paper',
  useTheme: () => ({ breakpoints: { up: () => 'lg' }, zIndex: { modal: 1300, appBar: 1100 } }),
  useMediaQuery: () => true,
}

function compile(file, extra) {
  const source = read(...file.split('/'))
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  const bindings = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
    '@mui/icons-material': { Star: 'icon-star', StarBorder: 'icon-star-border' },
    '@mui/icons-material/CloseRounded': 'icon-close',
    '../format': { formatBytes: (bytes) => String(bytes) + ' B' },
    '../media-viewer': { xDriveMediaCaptureTimeValue: () => '未记录' },
    '../file-preview': { xDriveClassifyFilePreview: () => 'image' },
    '../media-edit': { xDriveMediaEditPreviewTransform: () => undefined },
    './MediaGalleryUtils': {
      xDriveMediaFormatDuration: () => '',
      xDriveMediaGalleryErrorMessage: (error) => error instanceof Error ? error.message : String(error),
    },
    './usePreviewSlideshow': { useXDrivePreviewPresentation: () => ({}) },
    './FilePreviewSurface': { XDriveFilePreviewSurface: 'preview-surface' },
    './LivePhotoSurface': { XDriveLivePhotoSurface: 'live-surface' },
    './MediaGalleryPreviewMedia': {
      XDriveMediaAsyncThumbnail: 'async-thumbnail',
      xDriveMediaFallback: () => 'file',
    },
    './StatusAlert': { XDriveStatusAlert: 'status-alert' },
    ...extra,
  }
  const localRequire = (request) => bindings[request] ?? {}
  new Function('exports', 'module', 'require', compiled)(mod.exports, mod, localRequire)
  return mod.exports
}

const details = compile('ui/shared/src/mui/MediaGalleryDetails.tsx')
const { XDriveMediaDetailsInspector: Inspector } = compile(
  'ui/shared/src/mui/MediaGalleryInspector.tsx',
  { './MediaGalleryDetails': details },
)

function item(id, revision, label) {
  return {
    node: { id, revision, name: label + '.jpg', size: 1024, type: 'file' },
    metadata: { media_kind: 'image', index_state: 'ready', mime_type: 'image/jpeg', has_thumbnail: false },
    tags: [label + ' tag'],
    people: [label + ' person'],
    description: label + ' description',
    favorite: false,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function props(selected, actions = {}) {
  return {
    item: selected,
    showPreview: false,
    loadThumbnail: async () => null,
    albums: [],
    onClose: () => {},
    ...actions,
  }
}
function field(root, label) {
  const matches = root.findAll((element) => element.type === 'input' && element.props.label === label)
  assert.equal(matches.length, 1, 'expected exactly one visible input: ' + label)
  return matches[0]
}
function button(root, label) {
  const matches = root.findAll((element) =>
    element.type === 'button' && element.props.children === label)
  assert.equal(matches.length, 1, 'expected exactly one action: ' + label)
  return matches[0]
}
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('real shared Inspector ignores stale A tag/people/description completions after navigating to B', async () => {
  const pendingTags = deferred(), pendingPeople = deferred(), pendingDescription = deferred()
  const source = {
    onSetTags: async (selected) => { assert.equal(selected.node.id, 11); return pendingTags.promise },
    onSetPeople: async (selected) => { assert.equal(selected.node.id, 11); return pendingPeople.promise },
    onSetDescription: async (selected) => { assert.equal(selected.node.id, 11); return pendingDescription.promise },
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(Inspector, props(item(11, 1, 'A'), source))) })
  await act(async () => {
    button(view.root, '保存标签').props.onClick()
    button(view.root, '保存人物').props.onClick()
    button(view.root, '保存描述').props.onClick()
    await flush()
  })
  await act(async () => {
    view.update(React.createElement(Inspector, props(item(22, 3, 'B'), source)))
    await flush()
  })
  await act(async () => {
    field(view.root, '标签').props.onChange({ target: { value: 'B draft tag' } })
    field(view.root, '人物').props.onChange({ target: { value: 'B draft person' } })
    field(view.root, '描述').props.onChange({ target: { value: 'B draft description' } })
  })
  await act(async () => {
    pendingTags.resolve(['A stored tag'])
    pendingPeople.resolve(['A stored person'])
    pendingDescription.reject(new Error('A save rejected'))
    await flush()
  })
  assert.equal(field(view.root, '标签').props.value, 'B draft tag')
  assert.equal(field(view.root, '人物').props.value, 'B draft person')
  assert.equal(field(view.root, '描述').props.value, 'B draft description')
  assert.equal(view.root.findAll((node) => node.type === 'status-alert' &&
    String(node.props.children).includes('A save rejected')).length, 0)
  await act(async () => { view.unmount() })
})

test('same media ID with a new revision resets the Inspector draft', async () => {
  let view
  await act(async () => { view = renderer.create(React.createElement(Inspector, props(item(41, 7, 'same'), { onSetTags: async () => [] }))) })
  await act(async () => {
    field(view.root, '标签').props.onChange({ target: { value: 'stale revision draft' } })
  })
  await act(async () => {
    view.update(React.createElement(Inspector, props(item(41, 8, 'same'), { onSetTags: async () => [] })))
    await flush()
  })
  assert.equal(field(view.root, '标签').props.value, 'same tag')
  await act(async () => { view.unmount() })
})

test('Gallery selection and loaded-node callbacks must additionally verify the media revision', () => {
  const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
  const inspectorCallbacks = gallery.slice(
    gallery.lastIndexOf('onSetFavorite={!isTrashSection'),
    gallery.lastIndexOf('onClose={() => setSelected(null)}'),
  )
  const selectedGuards = inspectorCallbacks.match(/current\?\.node\.revision === item\.node\.revision/g) ?? []
  assert.equal(selectedGuards.length, 4, 'favorite, tags, people and description must reject stale revision writes')
  const sourceMutations = gallery.slice(gallery.indexOf('const setFavorite = useCallback'), gallery.indexOf('const saveEditRecipe = useCallback'))
  assert.match(sourceMutations, /value\.node\.revision === item\.node\.revision/, 'loaded media mutations must verify the revision')
})
