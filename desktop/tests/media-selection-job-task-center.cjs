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
const file = 'ui/shared/src/mui/MediaSelectionJobCenter.tsx'
const code = ts.transpileModule(read(file), {
  fileName: path.join(root, file),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress', Divider: 'divider',
  LinearProgress: 'linear-progress', Paper: 'paper', Stack: 'stack',
  Typography: 'typography',
}
const mods = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const current = { exports: {} }
new Function('exports', 'module', 'require', code)(current.exports, current, name => {
  if (!Object.hasOwn(mods, name)) throw Error('Unexpected dependency: ' + name)
  return mods[name]
})
const JobCenter = current.exports.XDriveMediaSelectionJobCenter
const job = overrides => ({
  id: 'job-1', action: 'favorite', favorite: true,
  status: 'queued', total_items: 230, processed_items: 0,
  succeeded_items: 0, failed_items: 0, cancelled_items: 0,
  created_at: '2026-10-09T20:00:00Z', updated_at: '2026-10-09T20:00:00Z',
  ...overrides,
})
const button = (view, text) => view.root.findAll(x =>
  x.type === 'button' && x.props.children === text)[0]

test('Task Center shows durable queued/completed counts and uses server action controls', async () => {
  let task = job({})
  let cancels = 0
  let view
  const port = {
    list: async () => [task],
    cancel: async id => {
      assert.equal(id, task.id)
      cancels++
      task = job({ status: 'cancel_requested' })
    },
    retry: async () => { throw Error('not used') },
    failures: async () => { throw Error('not used') },
  }
  await act(async () => { view = renderer.create(React.createElement(JobCenter, { port })) })
  assert.equal(view.root.findAll(x => x.props['data-xdrive-media-job'] === task.id).length, 1)
  const progress = view.root.findAll(x => x.type === 'linear-progress')[0]
  assert.equal(progress.props.value, 0)
  await act(async () => { button(view, '取消任务').props.onClick() })
  assert.equal(cancels, 1)
  assert.equal(view.root.findAll(x => x.type === 'button' && x.props.children === '取消任务').length, 0)
  await act(async () => { view.unmount() })
})

test('Task Center presents partial failure details and immutable-revision retry', async () => {
  let task = job({ status: 'partial', processed_items: 230, succeeded_items: 229, failed_items: 1 })
  const calls = { page: 0, retry: 0 }
  const port = {
    list: async () => [task],
    cancel: async () => {},
    retry: async id => {
      assert.equal(id, task.id)
      calls.retry++
      task = job({ id: 'retry-2', total_items: 1 })
      return task
    },
    failures: async (id, offset, limit) => {
      calls.page++
      assert.deepEqual([id, offset, limit], ['job-1', 0, 100])
      return { items: [{ node_id: 9, revision: 2, status: 'failed', failure_code: 'stale_revision' }],
        total: 1, offset, limit, has_more: false }
    },
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(JobCenter, { port })) })
  assert.equal(view.root.findAll(x => x.type === 'linear-progress')[0].props.value, 100)
  await act(async () => { button(view, '查看失败详情').props.onClick() })
  assert.equal(calls.page, 1)
  assert.equal(view.root.findAll(x => x.props['data-xdrive-media-job-failures'] === 'job-1').length, 1)
  await act(async () => { button(view, '重试未成功项').props.onClick() })
  assert.equal(calls.retry, 1)
  assert.equal(view.root.findAll(x => x.props['data-xdrive-media-job'] === 'retry-2').length, 1)
  await act(async () => { view.unmount() })
})

test('Task Center only polls while visible and never loads a 100k MediaItem array', () => {
  const shared = read('ui/shared/src/mui/TaskCenterPage.tsx')
  const web = read('web/src/App.tsx')
  const code = read(file)
  assert.match(web, /mediaSelectionJobPort=\{appView === 'transfers' \? mediaSelectionJobPort : undefined\}/)
  assert.match(shared, /mediaSelectionJobPort \?/)
  assert.match(code, /setInterval\(refresh, 2500\)/)
  assert.match(code, /clearInterval\(timer\)/)
  assert.doesNotMatch(code, /listItemRange|downloadArchive|MediaItem\[\]|arrayBuffer\(/)
})
