const test = require('node:test')
const assert = require('node:assert/strict')
const { DesktopLoginIntents } = require('../dist/main/login_intents.cjs')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('logout cancels a pending anonymous selection before credentials can be sent', async () => {
  const intents = new DesktopLoginIntents(); const old = intents.begin(); const actions = []
  await intents.logout(async () => actions.push('logout'))
  assert.equal(old.signal.aborted, true)
  await assert.rejects(intents.run(old, async () => actions.push('old-login')))
  assert.deepEqual(actions, ['logout'])
})
test('a newer login invalidates an older probe, and logout finishes after an already dispatched login', async () => {
  const intents = new DesktopLoginIntents(); const old = intents.begin(); const latest = intents.begin()
  const actions = []
  await assert.rejects(intents.run(old, async () => actions.push('obsolete')))
  const entered = deferred(); const release = deferred()
  const request = intents.run(latest, async () => { actions.push('login-start'); entered.resolve(); await release.promise; actions.push('login-end') })
  await entered.promise
  const logout = intents.logout(async () => actions.push('logout'))
  assert.equal(latest.current(), false)
  release.resolve(); await Promise.allSettled([request, logout])
  assert.deepEqual(actions, ['login-start', 'login-end', 'logout'])
})
