import { spawn } from 'node:child_process'
import os = require('node:os')
import path = require('node:path')
import {
  AgentIPCClient,
  AgentIPCError,
  type AgentHello,
} from './agent_client.cjs'

type LifecycleClient = Pick<AgentIPCClient, 'hello' | 'shutdown' | 'invalidate'>
type SpawnProcess = (command: string) => Promise<void>
type Sleep = (ms: number) => Promise<void>

const readyTimeoutMs = 10_000
const stopTimeoutMs = 5_000
const retryDelayMs = 250

export class AgentLifecycle {
  private lastSpawnAt = 0

  constructor(
    private readonly client: LifecycleClient,
    private readonly candidates = defaultAgentCandidates(),
    private readonly spawnProcess: SpawnProcess = startDetachedProcess,
    private readonly sleep: Sleep = delay,
  ) {}

  async ensureRunning(): Promise<AgentHello> {
    try {
      return requireFullAgent(await this.client.hello())
    } catch (error) {
      if (!isRecoverableUnavailable(error)) throw error
    }

    await this.spawnAgent()
    return this.waitUntilReady()
  }

  async restart(): Promise<AgentHello> {
    try {
      // A Desktop restart must not stop a CLI-only Agent that may be
      // committing an original durable file Operation.
      requireFullAgent(await this.client.hello())
      await this.client.shutdown()
      await this.waitUntilStopped()
    } catch (error) {
      if (!isRecoverableUnavailable(error)) throw error
    }

    this.client.invalidate()
    await this.spawnAgent(true)
    return this.waitUntilReady()
  }

  private async waitUntilReady(): Promise<AgentHello> {
    const deadline = Date.now() + readyTimeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
      this.client.invalidate()
      try {
        return requireFullAgent(await this.client.hello())
      } catch (error) {
        if (!isRecoverableUnavailable(error)) throw error
        lastError = error
      }
      await this.sleep(retryDelayMs)
    }
    throw new AgentIPCError(
      'agent_start_timeout',
      0,
      lastError instanceof Error
        ? `xdrive-agent did not become ready: ${lastError.message}`
        : 'xdrive-agent did not become ready in time.',
    )
  }

  private async waitUntilStopped() {
    const deadline = Date.now() + stopTimeoutMs
    while (Date.now() < deadline) {
      this.client.invalidate()
      try {
        await this.client.hello()
      } catch (error) {
        if (isRecoverableUnavailable(error)) return
        throw error
      }
      await this.sleep(retryDelayMs)
    }
    throw new AgentIPCError('agent_stop_timeout', 0, 'xdrive-agent did not stop in time.')
  }

  private async spawnAgent(force = false) {
    const now = Date.now()
    if (!force && now-this.lastSpawnAt < 2_000) {
      await this.sleep(2_000-(now-this.lastSpawnAt))
    }
    this.lastSpawnAt = Date.now()

    let lastError: unknown
    for (const command of this.candidates) {
      try {
        await this.spawnProcess(command)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw new AgentIPCError(
      'agent_not_installed',
      0,
      lastError instanceof Error
        ? `Unable to start xdrive-agent: ${lastError.message}`
        : 'xdrive-agent is not installed or could not be started.',
    )
  }
}

export function defaultAgentCandidates() {
  const result: string[] = []
  const override = process.env.XD_AGENT_PATH?.trim()
  if (override) result.push(override)

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    result.push(path.join(localAppData, 'Programs', 'xDrive', 'xdrive-agent.exe'))
    result.push('xdrive-agent.exe')
  } else {
    result.push('/usr/bin/xdrive-agent')
    result.push('xdrive-agent')
  }
  return [...new Set(result)]
}

// Fail closed for an explicitly headless Agent and for older agents that
// cannot prove their runtime. A running backup is never stopped or replaced.
function requireFullAgent(hello: AgentHello): AgentHello {
  if (hello.runtime_mode === 'backup_only') {
    throw new AgentIPCError(
      'agent_backup_only',
      0,
      'xdrive-agent is running in Backup-only mode. Backups remain active. Stop its user-level backup service only after reviewing active tasks, then start the full Desktop Agent.',
    )
  }
  if (hello.runtime_mode !== 'full') {
    throw new AgentIPCError(
      'incompatible_agent',
      0,
      'xdrive-agent did not report a verified runtime mode. Update the matched xDrive Agent and Desktop packages before controlling synchronization.',
    )
  }
  return hello
}

function isRecoverableUnavailable(error: unknown) {
  return error instanceof AgentIPCError &&
    (error.code === 'agent_unavailable' || error.code === 'aborted')
}

function startDetachedProcess(command: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.removeListener('error', reject)
      child.unref()
      resolve()
    })
  })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
