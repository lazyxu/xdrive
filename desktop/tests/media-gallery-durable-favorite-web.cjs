const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'ui/shared/src/mui/MediaGalleryQuerySelection.tsx'
const js = ts.transpileModule(read(file), {
  fileName: path.join(root, file),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress',
  Dialog: 'dialog', DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  Stack: 'stack', TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => false,
}
const deps = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material/CloseRounded': 'close',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', js)(mod.exports, mod, name => {
  if (!Object.hasOwn(deps, name)) throw Error('Unexpected import: ' + name)
  return deps[name]
})
const UI = mod.exports.XDriveMediaGalleryQuerySelection
const snapshot = { token: 'frozen-query', version: 5, total: 230, selected: 230,
  excluded: 0, expires_at: '2026-10-09T23:00:00Z', day: '' }
const item = n => ({ node_id: n, revision: 2, name: 'photo-' + n, stale: false })
const page = { ...snapshot, offset: 0, limit: 100, items: [item(1)], has_more: false }
const mkJob = (overrides = {}) => ({
  id: 'durable-job-1', action: 'favorite', favorite: true, status: 'queued',
  total_items: 230, processed_items: 0, succeeded_items: 0, failed_items: 0,
  cancelled_items: 0, created_at: '2026-10-09T23:00:00Z', updated_at: '2026-10-09T23:00:00Z',
  ...overrides,
})
const select = (view, attr) => view.root.findAll(el => el.type === 'button' && el.props[attr])[0]
const named = (view, text) => view.root.findAll(el =>
  el.type === 'button' && el.props.children === text)[0]
const props = actions => ({ actions, timeZone: 'Asia/Singapore', sortBy: 'added' })

test('G07 durable favorite requires separate user confirmation, exact token and version', async () => {
  const submissions = []
  const releases = []
  const actions = {
    create: async () => snapshot,
    page: async () => page,
    exclude: async () => { throw Error('not used') },
    release: async token => { releases.push(token) },
    submitFavorite: async (token, version, favorite) => {
      submissions.push([token, version, favorite])
      return mkJob({ favorite })
    },
    getJob: async () => mkJob(),
    cancelJob: async () => {},
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(UI, props(actions))) })
  assert.equal(submissions.length, 0, 'Gallery first paint cannot submit')
  await act(async () => { select(view, 'data-xdrive-gallery-select-query').props.onClick() })
  assert.equal(submissions.length, 0, 'creating snapshot is never an operation')
  await act(async () => { select(view, 'data-xdrive-gallery-submit-unfavorite').props.onClick() })
  assert.equal(submissions.length, 0, 'opening confirm cannot submit')
  await act(async () => { named(view, '返回审核').props.onClick() })
  assert.equal(submissions.length, 0)
  await act(async () => { select(view, 'data-xdrive-gallery-submit-favorite').props.onClick() })
  await act(async () => { select(view, 'data-xdrive-gallery-confirm-durable-favorite').props.onClick() })
  assert.deepEqual(submissions, [['frozen-query', 5, true]])
  assert.equal(view.root.findAll(el => el.props['data-xdrive-gallery-durable-job']).length, 1)
  await act(async () => { named(view, '完成审核').props.onClick() })
  assert.deepEqual(releases, [], 'server already consumed the submitted snapshot')
  await act(async () => { view.unmount() })
})

test('G07 partial job displays exact failure details, retry and cancellation stay explicit', async () => {
  let job = mkJob({ status: 'partial', processed_items: 230,
    succeeded_items: 228, failed_items: 2 })
  const calls = { cancelled: 0, retries: 0, failures: 0 }
  const actions = {
    create: async () => snapshot,
    page: async () => page,
    exclude: async () => { throw Error('not used') },
    release: async () => {},
    submitFavorite: async () => job,
    getJob: async () => job,
    cancelJob: async () => { calls.cancelled++ },
    retryJob: async () => {
      calls.retries++
      job = mkJob({ id: 'retry-2', total_items: 2 })
      return job
    },
    failures: async (_id, offset, limit) => {
      calls.failures++
      assert.equal(offset, 0)
      assert.equal(limit, 100)
      return { items: [
        { node_id: 8, revision: 1, status: 'failed', failure_code: 'stale_revision' },
        { node_id: 9, revision: 3, status: 'failed', failure_code: 'node_unavailable' },
      ], offset: 0, limit: 100, total: 2, has_more: false }
    },
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(UI, props(actions))) })
  await act(async () => { select(view, 'data-xdrive-gallery-select-query').props.onClick() })
  await act(async () => { select(view, 'data-xdrive-gallery-submit-favorite').props.onClick() })
  await act(async () => { select(view, 'data-xdrive-gallery-confirm-durable-favorite').props.onClick() })
  assert.ok(named(view, '重试未成功项'))
  await act(async () => { named(view, '查看失败详情').props.onClick() })
  assert.equal(calls.failures, 1)
  assert.equal(view.root.findAll(el => el.props['data-xdrive-gallery-job-failures']).length, 1)
  await act(async () => { named(view, '重试未成功项').props.onClick() })
  assert.equal(calls.retries, 1)
  assert.ok(named(view, '取消任务'))
  await act(async () => { named(view, '取消任务').props.onClick() })
  assert.equal(calls.cancelled, 1)
  await act(async () => { view.unmount() })
})

test('G07 Web durable operation is an explicit server-owned job, not a 100k MediaItem batch', () => {
  const api = read('web/src/api.ts')
  const port = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const ui = read(file)
  assert.match(api, /action: 'favorite', favorite, confirm: true/)
  assert.match(api, /media\/selection-snapshots\/\$\{encodeURIComponent\(token\)\}\/jobs/)
  assert.match(api, /media\/selection-jobs\/\$\{encodeURIComponent\(jobID\)\}\/failures/)
  assert.match(port, /submitSelectionFavoriteJob/)
  assert.match(gallery, /submitFavorite: source.submitSelectionFavoriteJob/)
  assert.doesNotMatch(ui, /onDeleteItems|onSetFavoriteBatch|downloadArchive|Array\.from\(.*MediaItem/)
  assert.match(ui, /getJob/)
  assert.match(ui, /clearInterval\(timer\)/)
})
