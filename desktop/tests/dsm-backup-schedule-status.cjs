'use strict'
// Mounted DSM automatic-plan regression: one expanded owning Source only.
// Saved schedule is NOT a verified Agent checkpoint, CAS receipt or exact due time.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')

function loadTS(file, imports) {
  const source = path.join(root, file)
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    fileName: source,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((compiled.diagnostics || []).filter(
    item => item.category === ts.DiagnosticCategory.Error,
  ).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, name => {
      if (!(name in imports)) throw new Error('Unapproved DSM schedule import: ' + name)
      return imports[name]
    },
  )
  return mod.exports
}

function stub(name) {
  return function Stub({ children, ...props }) {
    return React.createElement(name, props, children)
  }
}
const pure = loadTS('ui/shared/src/synology-task-status.ts', {})
const Component = loadTS('ui/shared/src/mui/SynologyBackupScheduleStatus.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': Object.fromEntries(
    ['Button', 'Stack', 'Typography'].map(name => [name, stub(name)]),
  ),
  '../synology-task-status': pure,
}).XDriveSynologyBackupScheduleStatus
assert.equal(typeof Component, 'function')

function schedule(source_id, schedule_type = 'interval', more = {}) {
  return {
    source_id, revision: 4, schedule_type,
    schedule_expression: schedule_type === 'interval' ? '6h' :
      schedule_type === 'cron' ? '0 3 * * *' : '',
    schedule_timezone: schedule_type === 'cron' ? 'Asia/Shanghai' : '',
    ...more,
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}
async function mount(client, sourceID = 57, refreshEpoch = 0) {
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Component, {
      client, sourceID, refreshEpoch,
    }))
    await Promise.resolve()
  })
  return tree
}

test('one expanded DSM Source reads saved plan without implying it is armed or due', async () => {
  const calls = []
  const client = { load: async id => {
    calls.push(id)
    return schedule(id)
  } }
  const tree = await mount(client)
  assert.deepEqual(calls, [57], 'only the user-expanded Source may query its plan')
  const body = textOf(tree.toJSON())
  assert.match(body, /自动计划已保存/)
  assert.match(body, /每 6h/)
  assert.match(body, /需先完成可信的手动备份/)
  assert.match(body, /尚未提供可核验的调度时间/)
  assert.doesNotMatch(body, /下一次.*\d{2}:\d{2}/)
  await act(async () => tree.unmount())
})

test('manual, unset and Cron modes are distinct and never imply a previous backup', async () => {
  for (const [kind, target] of [
    ['manual', /自动计划已关闭/],
    ['', /尚未明确开启自动备份/],
    ['cron', /Cron 0 3 \* \* \*（Asia\/Shanghai）/],
  ]) {
    const tree = await mount({ load: async id => schedule(id, kind) })
    assert.match(textOf(tree.toJSON()), target)
    if (kind !== 'cron') {
      assert.doesNotMatch(textOf(tree.toJSON()), /下次实际执行时间/)
    }
    await act(async () => tree.unmount())
  }
})

test('wrong Source, corrupted schedule, and private Agent errors never render a false auto badge', async () => {
  for (const bad of [
    schedule(58),
    schedule(57, 'interval', { revision: 0 }),
    schedule(57, 'interval', { schedule_timezone: 'UTC' }),
    schedule(57, 'cron', { schedule_expression: 'bad' }),
  ]) {
    const tree = await mount({ load: async () => bad })
    const body = textOf(tree.toJSON())
    assert.match(body, /自动计划无法核验/)
    assert.doesNotMatch(body, /自动计划已保存/)
    await act(async () => tree.unmount())
  }
  let calls = 0
  const tree = await mount({ load: async () => {
    calls++
    if (calls === 1) throw new Error('private Agent session token')
    return schedule(57, 'manual')
  } })
  assert.doesNotMatch(textOf(tree.toJSON()), /private Agent session token/)
  const refresh = tree.root.findByType('Button')
  await act(async () => { refresh.props.onClick(); await Promise.resolve() })
  assert.equal(calls, 2)
  assert.match(textOf(tree.toJSON()), /自动计划已关闭/)
  await act(async () => tree.unmount())
})

test('Host A -> B and stale read completion never show the previous Owner plan', async () => {
  const pending = deferred()
  const A = { load: () => pending.promise }
  const B = { load: async id => schedule(id, 'manual') }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Component, {
      key: 'A:57', client: A, sourceID: 57, refreshEpoch: 0,
    }))
    await Promise.resolve()
  })
  await act(async () => {
    tree.update(React.createElement(Component, {
      key: 'B:58', client: B, sourceID: 58, refreshEpoch: 0,
    }))
    await Promise.resolve()
  })
  assert.match(textOf(tree.toJSON()), /自动计划已关闭/)
  await act(async () => {
    pending.resolve(schedule(57, 'cron'))
    await Promise.resolve()
  })
  assert.match(textOf(tree.toJSON()), /自动计划已关闭/)
  assert.doesNotMatch(textOf(tree.toJSON()), /Cron/)
  await act(async () => tree.unmount())
})

test('saving a plan refreshes the one selected Source via refresh epoch, not all Sources', async () => {
  let calls = 0
  const client = { load: async id => {
    calls++
    return schedule(id, calls === 1 ? 'manual' : 'interval')
  } }
  let tree = await mount(client)
  assert.match(textOf(tree.toJSON()), /仅手动备份/)
  await act(async () => {
    tree.update(React.createElement(Component, {
      client, sourceID: 57, refreshEpoch: 1,
    }))
    await Promise.resolve()
  })
  assert.equal(calls, 2)
  assert.match(textOf(tree.toJSON()), /自动计划已保存/)
  assert.doesNotMatch(textOf(tree.toJSON()), /自动计划已关闭/)
  await act(async () => tree.unmount())
})
