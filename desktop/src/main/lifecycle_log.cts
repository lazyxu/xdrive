import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path = require('node:path')

type LifecycleLogOptions = {
  maxBytes?: number
  now?: () => Date
  pid?: number
}

type LifecycleStart = {
  version: string
  background: boolean
  channel?: string
  commit?: string
}

type LifecycleFields = Record<string, string | number | boolean | null | undefined>

const defaultMaxBytes = 2 * 1024 * 1024

export function formatLifecycleError(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  return String(error)
}

export class DesktopLifecycleLog {
  private readonly logPath: string
  private readonly rotatedLogPath: string
  private readonly markerPath: string
  private readonly maxBytes: number
  private readonly now: () => Date
  private readonly pid: number

  constructor(directory: string, options: LifecycleLogOptions = {}) {
    this.logPath = path.join(directory, 'desktop.log')
    this.rotatedLogPath = path.join(directory, 'desktop.log.1')
    this.markerPath = path.join(directory, 'desktop-running.json')
    this.maxBytes = options.maxBytes ?? defaultMaxBytes
    this.now = options.now ?? (() => new Date())
    this.pid = options.pid ?? process.pid
  }

  start(details: LifecycleStart) {
    this.safely(() => {
      mkdirSync(path.dirname(this.logPath), { recursive: true })
      this.rotateIfNeeded()
      if (existsSync(this.markerPath)) {
        let previous: Record<string, unknown> = {}
        try {
          previous = JSON.parse(readFileSync(this.markerPath, 'utf8')) as Record<string, unknown>
        } catch {
          previous = {}
        }
        this.append('previous_session_unclean', {
          previous_pid: typeof previous.pid === 'number' ? previous.pid : null,
          previous_started_at: typeof previous.started_at === 'string' ? previous.started_at : null,
          previous_version: typeof previous.version === 'string' ? previous.version : null,
        })
      }
      const startedAt = this.now().toISOString()
      const marker = {
        pid: this.pid,
        started_at: startedAt,
        version: details.version,
        background: details.background,
      }
      writeFileSync(this.markerPath, JSON.stringify(marker, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
      this.append('start', {
        pid: this.pid,
        version: details.version,
        channel: details.channel,
        commit: details.commit,
        background: details.background,
      })
    })
  }

  record(event: string, fields: LifecycleFields = {}) {
    this.safely(() => this.append(event, fields))
  }

  cleanExit(reason: string, exitCode: number) {
    this.safely(() => {
      this.append('clean_exit', { reason, exit_code: exitCode })
      rmSync(this.markerPath, { force: true })
    })
  }

  private append(event: string, fields: LifecycleFields) {
    const entry = { timestamp: this.now().toISOString(), event, ...fields }
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  }

  private rotateIfNeeded() {
    if (!existsSync(this.logPath) || statSync(this.logPath).size < this.maxBytes) return
    rmSync(this.rotatedLogPath, { force: true })
    renameSync(this.logPath, this.rotatedLogPath)
  }

  private safely(action: () => void) {
    try {
      action()
    } catch (error) {
      console.error('failed to write xDrive Desktop lifecycle log:', error)
    }
  }
}
