const assert = require('node:assert/strict')
const test = require('node:test')

const { AgentLifecycle } = require('../dist/main/agent_lifecycle.cjs')
const { AgentIPCError } = require('../dist/main/agent_client.cjs')

function hello(version = 'test') {
  return {
    discovery_version: 1,
    protocol_min: 2,
    protocol_max: 2,
    agent_version: version,
    pid: 42,
    platform: 'linux',
    arch: 'amd64',
    runtime_mode: 'full',
    capabilities: [],
  }
}

test('lifecycle starts an unavailable agent and waits for readiness', async () => {
  let helloCalls = 0
  let spawns = 0
  const client = {
    async hello() {
      helloCalls++
      if (helloCalls < 3) throw new AgentIPCError('agent_unavailable', 0, 'down')
      return hello()
    },
    async shutdown() { return { ok: true } },
    invalidate() {},
  }
  const lifecycle = new AgentLifecycle(
    client,
    ['/fake/xdrive-agent'],
    async () => { spawns++ },
    async () => {},
  )
  const result = await lifecycle.ensureRunning()
  assert.equal(result.agent_version, 'test')
  assert.equal(spawns, 1)
})

test('lifecycle does not spawn over an incompatible running agent', async () => {
  let spawns = 0
  const client = {
    async hello() { throw new AgentIPCError('incompatible_agent', 0, 'mismatch') },
    async shutdown() { return { ok: true } },
    invalidate() {},
  }
  const lifecycle = new AgentLifecycle(
    client,
    ['/fake/xdrive-agent'],
    async () => { spawns++ },
    async () => {},
  )
  await assert.rejects(lifecycle.ensureRunning(), /mismatch/)
  assert.equal(spawns, 0)
})

test('lifecycle restart waits for shutdown before starting a new agent', async () => {
  let running = true
  let spawns = 0
  const client = {
    async hello() {
      if (!running) {
        if (spawns > 0) return hello('restarted')
        throw new AgentIPCError('agent_unavailable', 0, 'down')
      }
      return hello('old')
    },
    async shutdown() {
      running = false
      return { ok: true }
    },
    invalidate() {},
  }
  const lifecycle = new AgentLifecycle(
    client,
    ['/fake/xdrive-agent'],
    async () => { spawns++; running = false },
    async () => {},
  )
  const result = await lifecycle.restart()
  assert.equal(result.agent_version, 'restarted')
  assert.equal(spawns, 1)
})

test('Desktop does not spawn or shut down a running Backup-only Agent', async () => {
  let spawnCount = 0
  let shutdownCount = 0
  const agent = { ...hello('cli-only'), runtime_mode: 'backup_only' }
  const lifecycle = new AgentLifecycle({
    async hello() { return agent },
    async shutdown() { shutdownCount++; return { ok: true } },
    invalidate() {},
  }, ['/fake/xdrive-agent'], async () => { spawnCount++ }, async () => {})

  await assert.rejects(lifecycle.ensureRunning(), (error) =>
    error instanceof AgentIPCError && error.code === 'agent_backup_only')
  await assert.rejects(lifecycle.restart(), (error) =>
    error instanceof AgentIPCError && error.code === 'agent_backup_only')
  assert.equal(spawnCount, 0)
  assert.equal(shutdownCount, 0)
})

test('Desktop fails closed for a legacy Agent missing verified runtime mode', async () => {
  let spawnCount = 0
  let shutdownCount = 0
  const legacy = hello()
  delete legacy.runtime_mode
  const lifecycle = new AgentLifecycle({
    async hello() { return legacy },
    async shutdown() { shutdownCount++; return { ok: true } },
    invalidate() {},
  }, ['/fake/xdrive-agent'], async () => { spawnCount++ }, async () => {})

  await assert.rejects(lifecycle.ensureRunning(), (error) =>
    error instanceof AgentIPCError && error.code === 'incompatible_agent')
  await assert.rejects(lifecycle.restart(), (error) =>
    error instanceof AgentIPCError && error.code === 'incompatible_agent')
  assert.equal(spawnCount, 0)
  assert.equal(shutdownCount, 0)
})
