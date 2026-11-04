const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '..', '..', 'ui/shared/src/mui/FileExplorerRecentFolderUsage.ts')
const source = fs.readFileSync(filename, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', output)(mod, mod.exports, name => {
  if (name === 'react') return { useCallback: fn => fn, useEffect: () => {}, useRef: x => ({ current: x }) }
  return require(name)
})
const create = mod.exports.xDriveCreateRecentFolderScheduler

function fixture() {
  let time = 0
  let next = 0
  let visible = true
  const pending = new Map()
  const recorded = []
  const scheduler = create({
    record: async id => { recorded.push(id); return true },
    canRecord: () => visible,
    now: () => time,
    arm: (fn, ms) => {
      const id = ++next
      pending.set(id, { fn, at: time + ms })
      return id
    },
    disarm: id => pending.delete(id),
  })
  const advance = async ms => {
    time += ms
    for (const [id, task] of [...pending]) {
      if (task.at <= time) { pending.delete(id); task.fn() }
    }
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  }
  return { scheduler, recorded, advance, pending, setVisible: value => { visible = value } }
}

test('transit ancestors never enter Recent; only final 5-second folder is used', async () => {
  const f = fixture()
  f.scheduler.consider(101)
  await f.advance(800)
  f.scheduler.consider(102)
  await f.advance(500)
  f.scheduler.consider(103)
  await f.advance(4999)
  assert.deepEqual(f.recorded, [], 'no ancestor may be recorded')
  await f.advance(1)
  assert.deepEqual(f.recorded, [103])
  assert.equal(f.pending.size, 0)
})

test('file action confirms the owning folder immediately without duplicate entries', async () => {
  const f = fixture()
  f.scheduler.consider(111)
  await f.scheduler.confirm(111)
  assert.deepEqual(f.recorded, [111])
  await f.scheduler.confirm(111)
  assert.deepEqual(f.recorded, [111], 'same folder within sixty seconds must coalesce')
  f.scheduler.consider(112)
  await f.scheduler.confirm(112)
  await f.scheduler.confirm(111)
  assert.deepEqual(f.recorded, [111, 112, 111], 'return after another folder must re-rank')
  await f.advance(5001)
  assert.deepEqual(f.recorded, [111, 112, 111], 'stale pending timer must not replay')
})

test('root, invisible/disabled state, and account transitions cannot record', async () => {
  const f = fixture()
  f.scheduler.consider(41)
  f.scheduler.consider(0) // navigating to Cloud root cancels the previous child
  await f.advance(5001)
  assert.deepEqual(f.recorded, [])
  f.scheduler.consider(12)
  f.scheduler.reset() // account/session changed
  await f.advance(5001)
  assert.deepEqual(f.recorded, [])
  f.setVisible(false)
  f.scheduler.consider(14)
  await f.scheduler.confirm(14)
  await f.advance(5100)
  assert.deepEqual(f.recorded, [])
  f.setVisible(true)
  f.scheduler.consider(14)
  f.scheduler.cancel() // hidden tab/unmount
  await f.advance(5100)
  assert.deepEqual(f.recorded, [])
})

test('an unsuccessful record does not incorrectly throttle future folder use', async () => {
  let calls = 0
  const scheduler = create({ record: async () => { calls += 1; return calls > 1 } })
  assert.equal(await scheduler.confirm(42), false)
  assert.equal(await scheduler.confirm(42), true)
  assert.equal(calls, 2)
})

test('queued confirmation cannot touch a new Owner after a synchronous reset', async () => {
  const written = []
  const scheduler = create({ record: async id => { written.push(id); return true } })
  const pending = scheduler.confirm(42)
  scheduler.reset()
  assert.equal(await pending, false)
  assert.deepEqual(written, [])
})
