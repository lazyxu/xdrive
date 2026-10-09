const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const file = 'ui/shared/src/mui/MediaGalleryQuerySelection.tsx'
const output = ts.transpileModule(read(file), {
  fileName: path.join(root, file),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress', Dialog: 'dialog',
  DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  Stack: 'stack', TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => false,
}
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material/CloseRounded': 'close',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const moduleUnderTest = { exports: {} }
new Function('exports', 'module', 'require', output)(
  moduleUnderTest.exports, moduleUnderTest,
  (name) => {
    if (!Object.hasOwn(deps, name)) throw Error('Unexpected dependency ' + name)
    return deps[name]
  },
)
const Selection = moduleUnderTest.exports.XDriveMediaGalleryQuerySelection
const snapshot = {
  token: 'snapshot-token', version: 1, total: 230, selected: 230,
  excluded: 0, day: '', expires_at: '2026-10-09T20:00:00Z',
}
const row = (n) => ({
  node_id: n, revision: 2, name: 'image-' + n + '.jpg', stale: false,
})
const page = (offset, selected = 230, version = 1) => ({
  ...snapshot, selected, excluded: 230 - selected, version,
  offset, limit: 100,
  items: Array.from({ length: Math.min(100, Math.max(0, selected - offset)) },
    (_, i) => row(offset + i + 1)),
  has_more: offset + 100 < selected,
})
const queryButton = (view, attr) =>
  view.root.findAll((n) => n.type === 'button' && n.props[attr])[0]
const buttonText = (view, value) => view.root.findAll(
  (n) => n.type === 'button' && n.props.children === value,
)[0]
const rows = (view) => view.root.findAll(
  (n) => n.props['data-xdrive-gallery-snapshot-row'] !== undefined,
)
const renderProps = (actions, overrides = {}) => ({
  actions, timeZone: 'Asia/Singapore', sortBy: 'captured', ...overrides,
})


function deferredRace() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function mountRace(actions) {
  let view
  await act(async () => { view = renderer.create(React.createElement(Selection, renderProps(actions))) })
  return view
}
const tickRace = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const jobRace = {
  id: 'durable-favorite-1', status: 'completed', favorite: true,
  processed_items: 230, total_items: 230, succeeded_items: 230,
  failed_items: 0, cancelled_items: 0,
}
function actionsRace(overrides = {}) {
  return {
    create: async () => ({...snapshot}),
    page: async (token, offset) => ({...page(offset),token}),
    exclude: async () => ({...snapshot, selected: 229, excluded: 1, version: 2}),
    release: async () => {},
    ...overrides,
  }
}
async function startReviewRace(view) {
  await act(async () => { queryButton(view, 'data-xdrive-gallery-select-query').props.onClick(); await tickRace() })
  assert.equal(rows(view).length, 100)
}
async function openConfirmRace(view) {
  await act(async () => { queryButton(view, 'data-xdrive-gallery-submit-favorite').props.onClick() })
  assert.equal(view.root.findAll(n => n.type === 'dialog' && n.props['aria-label'] === '确认媒体批量收藏任务')[0].props.open,true)
}

test('Query selection: same-tick snapshot Create must make exactly one Server request', async () => {
  const pending=deferredRace(), calls=[], released=[]
  const actions=actionsRace({
    create: (day) => { calls.push(day); return pending.promise },
    release: async (token) => { released.push(token) },
  })
  const view=await mountRace(actions)
  try {
    const click=queryButton(view,'data-xdrive-gallery-select-query').props.onClick
    await act(async () => { click(); click(); await tickRace() })
    const requests=calls.length
    await act(async () => { pending.resolve({...snapshot}); await tickRace() })
    assert.equal(requests,1,'one same-render Create click series must not allocate two snapshots')
    assert.deepEqual(released,[],'winner snapshot must not be released by an overtaken Create')
  } finally {
    await act(async () => { view.unmount() })
  }
})

test('Query selection: same-tick durable Favorite confirmations must submit once', async () => {
  const pending=deferredRace(), submits=[]
  const view=await mountRace(actionsRace({
    submitFavorite: (token, version, favorite) => {
      submits.push([token,version,favorite])
      return pending.promise
    },
    getJob: async () => jobRace,
  }))
  try {
    await startReviewRace(view)
    await openConfirmRace(view)
    const click=queryButton(view,'data-xdrive-gallery-confirm-durable-favorite').props.onClick
    await act(async () => { click(); click(); await tickRace() })
    const count=submits.length
    await act(async () => { pending.resolve({...jobRace}); await tickRace() })
    assert.equal(count,1,'one frozen version must submit at most one durable job')
    assert.deepEqual(submits[0],['snapshot-token',1,true])
  } finally {
    await act(async () => { view.unmount() })
  }
})

test('Query selection: same-tick Exclude cannot issue duplicate versioned writes', async () => {
  const pending=deferredRace(), submissions=[]
  const view=await mountRace(actionsRace({
    exclude: (token,id,exclude,version) => {
      submissions.push([token,id,exclude,version])
      return pending.promise
    },
  }))
  try {
    await startReviewRace(view)
    const exclude=view.root.findAll(n => n.type === 'button' &&
      n.props['aria-label']==='排除 image-1.jpg')[0]
    assert.ok(exclude)
    await act(async () => { exclude.props.onClick(); exclude.props.onClick(); await tickRace() })
    const count=submissions.length
    await act(async () => { pending.resolve({...snapshot,selected:229,excluded:1,version:2}); await tickRace() })
    assert.equal(count,1,'one version cannot enqueue duplicate exclusion mutations')
    assert.deepEqual(submissions[0],['snapshot-token',1,true,1])
  } finally {
    await act(async () => { view.unmount() })
  }
})

test('Query selection: same-tick Page request must not double-fetch the cursor', async () => {
  const next=deferredRace(), calls=[]
  const view=await mountRace(actionsRace({
    page: (token,offset,limit) => {
      calls.push([token,offset,limit])
      return offset===100 ? next.promise : Promise.resolve({...page(offset),token})
    },
  }))
  try {
    await startReviewRace(view)
    const click=buttonText(view,'下一页').props.onClick
    await act(async () => { click(); click(); await tickRace() })
    const secondPageCount=calls.filter(([,offset])=>offset===100).length
    await act(async () => { next.resolve({...page(100),token:'snapshot-token'}); await tickRace() })
    assert.equal(secondPageCount,1,'same cursor page must have single-flight request ownership')
    assert.equal(rows(view)[0].props['data-xdrive-gallery-snapshot-row'],101)
  } finally {
    await act(async () => { view.unmount() })
  }
})

test('Query selection: stale Close handler cannot release token during a pending durable submission', async () => {
  const pending=deferredRace(), released=[]
  const view=await mountRace(actionsRace({
    submitFavorite: () => pending.promise,
    getJob: async () => jobRace,
    release: async token => { released.push(token) },
  }))
  try {
    await startReviewRace(view)
    await openConfirmRace(view)
    // Old click handlers still have busy=false until React flushes the next render.
    const confirm=queryButton(view,'data-xdrive-gallery-confirm-durable-favorite').props.onClick
    const close=buttonText(view,'完成审核').props.onClick
    await act(async () => { confirm(); close(); await tickRace() })
    const releasedDuringSubmit=[...released]
    const reviewOpen=view.root.findAll(n => n.type==='dialog' &&
      n.props['data-xdrive-gallery-query-selection-review'])[0]?.props.open
    await act(async () => { pending.resolve({...jobRace}); await tickRace() })
    assert.deepEqual(releasedDuringSubmit,[],
      'stale Close cannot release a token that is being submitted to a durable job')
    assert.equal(reviewOpen,true,'pending submission must retain its review surface')
  } finally {
    await act(async () => { view.unmount() })
  }
})
