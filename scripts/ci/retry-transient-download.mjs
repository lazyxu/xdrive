#!/usr/bin/env node
// Retry only confirmed transient dependency-download failures. Real compiler,
// test, packaging and signature failures remain terminal, not masked.
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write('Usage: retry-transient-download.mjs COMMAND [ARGS...]\n')
  process.exit(2)
}
const maxAttempts = 3
const delayMs = Math.max(0, Math.min(60_000, Number(process.env.XDRIVE_CI_RETRY_DELAY_MS ?? 10_000) || 0))
const maxCaptured = 128 * 1024
const transientHTTP = /(?:response code:?\s*504|HTTP(?:\s+response\s+code:?)?\s*504|gateway time-?out)/i
// A known-good Kotlin Gradle plugin occasionally cannot be resolved from
// external repositories on a fresh GitHub runner. Only the standalone master
// APK build opts into this narrow, bounded retry; compiler errors stay fatal.
const retryGradlePluginResolution = process.env.XDRIVE_CI_RETRY_GRADLE_PLUGIN_RESOLUTION === '1'
const transientGradlePlugin = /Plugin \[id: 'org\.jetbrains\.kotlin\.android', version: '[^']+', apply: false\] was not found in any of the following sources:/i

function attempt() {
  return new Promise((resolve) => {
    const command = args[0]
    // Windows needs cmd.exe to launch npm.cmd; all arguments are fixed by
    // repository workflows, never constructed from untrusted PR input.
    const child = spawn(command, args.slice(1), {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
    })
    let recent = ''
    const capture = (chunk, stream) => {
      const text = chunk.toString()
      stream.write(chunk)
      recent = (recent + text).slice(-maxCaptured)
    }
    child.stdout?.on('data', (data) => capture(data, process.stdout))
    child.stderr?.on('data', (data) => capture(data, process.stderr))
    child.on('error', (error) => {
      process.stderr.write(`[ci-retry] cannot start dependency build: ${error.message}\n`)
      resolve({ code: 127, transient: false })
    })
    child.on('close', (code, signal) => {
      const retryHTTP = transientHTTP.test(recent)
      const retryGradle = retryGradlePluginResolution && transientGradlePlugin.test(recent)
      resolve({
        code: code ?? 1,
        transient: !signal && (retryHTTP || retryGradle),
        reason: retryGradle ? 'Kotlin Gradle plugin resolution' : 'HTTP 504 dependency download',
      })
    })
  })
}

for (let i = 1; i <= maxAttempts; i++) {
  const result = await attempt()
  if (result.code === 0) process.exit(0)
  if (!result.transient || i === maxAttempts) {
    process.stderr.write(`[ci-retry] build failed with exit ${result.code}; ${result.transient ? 'transient download still unavailable' : 'not a transient download failure'}\n`)
    process.exit(result.code || 1)
  }
  process.stderr.write(`[ci-retry] ${result.reason}, retry ${i + 1}/${maxAttempts} after ${delayMs}ms\n`)
  await delay(delayMs)
}
