const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { buildSync } = require('esbuild')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { renderToStaticMarkup } = require('react-dom/server')
const material = require('@mui/material')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
function load(name, focusHost = false) {
  const bundled = buildSync({
    entryPoints: [path.join(repo, `ui/shared/src/mui/${name}.tsx`)], bundle: true, packages: 'external',
    platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
  }).outputFiles[0].text
  const module = { exports: {} }
  const FocusHostStack = React.forwardRef(({ children, ...props }, ref) => (
    props['data-xdrive-file-operation-center'] !== undefined
      ? React.createElement('div', { ref, 'data-xdrive-file-operation-center': true }, children)
      : React.createElement(material.Stack, { ...props, ref }, children)
  ))
  const requireShared = (request) => request.startsWith('@mui/icons-material/') ? require(request).default
    : focusHost && request === '@mui/material' ? { ...material, Stack: FocusHostStack } : require(request)
  new Function('module', 'exports', 'require', bundled)(module, module.exports, requireShared)
  return module.exports
}
const { XDriveFileOperationCenter: Center } = load('FileOperationCenter')
const { XDriveFileOperationCenter: FocusCenter } = load('FileOperationCenter', true)
const { XDriveTaskCenterPage: TaskPage } = load('TaskCenterPage')
const operation = (id, patch = {}) => ({
  id, type: 'copy', status: 'failed', total_items: 2, processed_items: 0,
  total_bytes: 2048, processed_bytes: 0, percent: 0, retryable: true,
  failure_code: 'name_conflict', error: 'target changed', current_item: '照片.jpg',
  conflict_policy: 'fail', created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
  ...patch,
})
const plainText = (html) => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')

test('real operation cards expose their exact identity and are programmatically focusable', () => {
  const html = renderToStaticMarkup(React.createElement(Center, { operations: [operation('requested-operation')] }))
  assert.match(html, /data-xdrive-file-operation-id="requested-operation"/)
  assert.match(html, /tabindex="-1"/)
  assert.match(plainText(html), /requested-operation/)
})

test('real conflict UI shows the current policy and explains replacement semantics', () => {
  const html = renderToStaticMarkup(React.createElement(Center, {
    operations: [operation('conflicted-operation')], onResolveConflict() {},
  }))
  const text = plainText(html)
  assert.match(text, /冲突策略.*遇到冲突时停止/)
  assert.match(text, /替换同名文件/)
  assert.match(text, /合并同名文件夹/)
})

test('operation focus waits for its exact card and consumes each request once across lifecycle updates', async () => {
  const target = operation('wanted')
  let nodes = []
  const events = []
  const element = (id) => ({
    dataset: { xdriveFileOperationId: id },
    scrollIntoView: (options) => events.push({ type: 'scroll', id, options }),
    focus: (options) => events.push({ type: 'focus', id, options }),
  })
  const props = { operationFocusID: 'wanted', operationFocusRequestID: 7 }
  let renderer
  // TestRenderer cannot implement native focus/scroll, and Emotion's server
  // build does not attach the outer stacking ref. Only that root host is mapped
  // to a mock DOM node; the real effect runs and browser cases verify native DOM.
  const createNodeMock = (entry) => entry.props['data-xdrive-file-operation-center'] !== undefined
    ? { querySelectorAll: () => nodes } : null
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(FocusCenter, { ...props, operations: [] }), { createNodeMock }) })
  try {
    assert.deepEqual(events, [], 'a missing card must not consume the request')
    nodes = [element('wrong'), element('wanted')]
    await TestRenderer.act(async () => { renderer.update(React.createElement(FocusCenter, { ...props, operations: [target] })) })
    assert.deepEqual(events.filter((event) => event.type === 'focus'), [{ type: 'focus', id: 'wanted', options: { preventScroll: true } }])
    const afterArrival = events.length
    await TestRenderer.act(async () => { renderer.update(React.createElement(FocusCenter, { ...props, operations: [{ ...target, status: 'running' }] })) })
    assert.equal(events.length, afterArrival, 'polling or regrouping the same operation must not steal focus again')
    await TestRenderer.act(async () => { renderer.update(React.createElement(FocusCenter, { ...props, operationFocusRequestID: 8, operations: [target] })) })
    assert.equal(events.filter((event) => event.type === 'focus').length, 2, 'a deliberate repeated details request may focus the same task again')
    assert.ok(events.filter((event) => event.type === 'scroll').every((event) => event.options.behavior !== 'smooth'), 'programmatic task focus should not require motion')
  } finally { await TestRenderer.act(async () => renderer.unmount()) }
})

test('Task Center forwards operation focus to its existing single shared file-operation center', async () => {
  let renderer
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(TaskPage, {
      transfers: [], operations: [operation('wanted')],
      operationFocusID: 'wanted', operationFocusRequestID: 9,
    }))
  })
  try {
    const centers = renderer.root.findAll((entry) => typeof entry.type === 'function' && entry.type.name === 'XDriveFileOperationCenter')
    assert.equal(centers.length, 1)
    assert.equal(centers[0].props.operationFocusID, 'wanted')
    assert.equal(centers[0].props.operationFocusRequestID, 9)
  } finally { await TestRenderer.act(async () => renderer.unmount()) }
})

function appFocusOwner(platform) {
  const filename = path.join(repo, platform === 'Web' ? 'web/src/App.tsx' : 'desktop/src/renderer/App.tsx')
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  const focusProps = new Map()
  function visit(entry) {
    if (ts.isVariableDeclaration(entry)) declarations.set(entry.name.getText(ast), entry)
    if (ts.isJsxOpeningElement(entry) || ts.isJsxSelfClosingElement(entry)) {
      if (entry.tagName.getText(ast) === 'XDriveTaskCenterPage') {
        for (const prop of entry.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
            focusProps.set(prop.name.getText(ast), prop.initializer.expression?.getText(ast))
          }
        }
      }
    }
    ts.forEachChild(entry, visit)
  }
  visit(ast)
  const first = declarations.get('filesOperationFocusSequenceRef')?.parent.parent
  const last = declarations.get('openFilesOperationTask')?.parent.parent
  assert.ok(first && last && first.parent === last.parent, `${platform} focus request has one App owner`)
  const statements = [...first.parent.statements]
  const body = statements.slice(statements.indexOf(first), statements.indexOf(last) + 1).map(entry => entry.getText(ast)).join('\n')
  for (const prop of ['operationFocusID', 'operationFocusRequestID']) assert.ok(focusProps.get(prop), `${platform} binds ${prop}`)
  const output = ts.transpileModule(body + `\nconst focusProps = { operationFocusID: ${focusProps.get('operationFocusID')}, operationFocusRequestID: ${focusProps.get('operationFocusRequestID')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  return (dependencies) => new Function(...Object.keys(dependencies), output + '\nreturn { filesOperationFocus, openFilesOperationTask, focusProps };')(...Object.values(dependencies))
}

for (const platform of ['Web', 'Desktop']) {
  test(`${platform} ordinary Task Center reopen does not replay a consumed Files focus request`, async () => {
    const runOwner = appFocusOwner(platform)
    const events = []
    const taskCenter = { pageProps: { onBackgroundScopeChange: scope => events.push({ type: 'scope', scope }) } }
    const target = {
      dataset: { xdriveFileOperationId: 'wanted' },
      scrollIntoView: () => {},
      focus: () => events.push({ type: 'focus', id: 'wanted' }),
    }
    const createNodeMock = entry => entry.props['data-xdrive-file-operation-center'] !== undefined
      ? { querySelectorAll: () => [target] } : null
    let current, renderer
    function AppHarness() {
      const [view, setView] = React.useState('files')
      const owner = runOwner({
        ...React, taskCenter, filesFeedbackLifecycleKey: 'account-a',
        view, appView: view, setView, setAppView: setView, setTaskCenterFocus: () => {},
      })
      current = { ...owner, navigate: setView }
      // App mounts TaskCenterPage only in its task views. View state itself is
      // the navigation boundary; the extracted owner and JSX props are live App code.
      return view === 'transfers' || view === 'global-tasks'
        ? React.createElement(FocusCenter, { ...owner.focusProps, operations: [operation('wanted')] }) : null
    }
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(AppHarness), { createNodeMock }) })
    try {
      await TestRenderer.act(async () => current.navigate('transfers'))
      assert.equal(events.filter(event => event.type === 'focus').length, 0, 'ordinary navigation with no Files request does not focus a task')
      await TestRenderer.act(async () => current.navigate('files'))
      await TestRenderer.act(async () => current.openFilesOperationTask('wanted'))
      assert.equal(events.filter(event => event.type === 'focus').length, 1, 'explicit View Task focuses its exact operation')
      await TestRenderer.act(async () => current.navigate('files'))
      await TestRenderer.act(async () => current.navigate('transfers'))
      assert.equal(events.filter(event => event.type === 'focus').length, 1, 'ordinary task navigation must not replay the earlier consumed focus request')
      await TestRenderer.act(async () => current.navigate('files'))
      await TestRenderer.act(async () => current.openFilesOperationTask('wanted'))
      assert.equal(events.filter(event => event.type === 'focus').length, 2, 'a later explicit View Task can focus the same operation again')
    } finally { await TestRenderer.act(async () => renderer.unmount()) }
  })
}
