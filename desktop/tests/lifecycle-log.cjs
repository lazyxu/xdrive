const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { DesktopLifecycleLog, formatLifecycleError } = require('../dist/main/lifecycle_log.cjs')

function temporaryLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-desktop-lifecycle-'))
}

function readEvents(dir) {
  return fs.readFileSync(path.join(dir, 'desktop.log'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

test('lifecycle log reports a stale running marker as an unclean previous exit', () => {
  const dir = temporaryLogDir()
  fs.writeFileSync(path.join(dir, 'desktop-running.json'), JSON.stringify({
    pid: 41,
    started_at: '2026-09-28T01:02:03.000Z',
    version: 'snapshot-old',
  }))
  const log = new DesktopLifecycleLog(dir, {
    now: () => new Date('2026-09-28T02:03:04.000Z'),
    pid: 42,
  })

  log.start({ version: 'snapshot-new', background: false })

  const events = readEvents(dir)
  assert.equal(events[0].event, 'previous_session_unclean')
  assert.equal(events[0].previous_pid, 41)
  assert.equal(events[1].event, 'start')
  assert.equal(events[1].pid, 42)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-running.json'), 'utf8')), {
    pid: 42,
    started_at: '2026-09-28T02:03:04.000Z',
    version: 'snapshot-new',
    background: false,
  })
})

test('clean exit removes the running marker and is not reported as a crash next time', () => {
  const dir = temporaryLogDir()
  const first = new DesktopLifecycleLog(dir, {
    now: () => new Date('2026-09-28T03:00:00.000Z'),
    pid: 51,
  })
  first.start({ version: 'snapshot-a', background: true })
  first.cleanExit('tray-menu', 0)

  const second = new DesktopLifecycleLog(dir, {
    now: () => new Date('2026-09-28T03:01:00.000Z'),
    pid: 52,
  })
  second.start({ version: 'snapshot-a', background: true })

  const events = readEvents(dir)
  assert.deepEqual(events.map((event) => event.event), ['start', 'clean_exit', 'start'])
  assert.equal(events[1].reason, 'tray-menu')
  assert.equal(events[1].exit_code, 0)
})

test('lifecycle log rotates before appending when the active log reached its limit', () => {
  const dir = temporaryLogDir()
  const active = path.join(dir, 'desktop.log')
  fs.writeFileSync(active, '12345678')
  const log = new DesktopLifecycleLog(dir, {
    maxBytes: 8,
    now: () => new Date('2026-09-28T04:00:00.000Z'),
    pid: 61,
  })

  log.start({ version: 'snapshot-b', background: false })

  assert.equal(fs.readFileSync(path.join(dir, 'desktop.log.1'), 'utf8'), '12345678')
  assert.equal(readEvents(dir)[0].event, 'start')
})

test('lifecycle errors retain useful stacks without serializing arbitrary objects', () => {
  const formatted = formatLifecycleError(new Error('renderer failed'))
  assert.match(formatted, /^Error: renderer failed/)
  assert.equal(formatLifecycleError({ token: 'must-not-leak' }), '[object Object]')
})
