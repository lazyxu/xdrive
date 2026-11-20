import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('./retry-transient-download.mjs', import.meta.url))
function runScenario(failures, text, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'xdrive-ci-retry-'))
  try {
    const fixture = join(dir, 'fixture.cjs')
    writeFileSync(fixture, `const fs=require('node:fs'); const path=require('node:path'); const countFile=path.join(process.cwd(), 'count'); let n=Number(fs.existsSync(countFile)?fs.readFileSync(countFile,'utf8'):'0')+1; fs.writeFileSync(countFile, String(n)); if(n<=${failures}) {console.error(${JSON.stringify(text)}); process.exit(14)} console.log('verified build');`)
    const result = spawnSync(process.execPath, [helper, process.execPath, fixture], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, XDRIVE_CI_RETRY_DELAY_MS: '1', XDRIVE_CI_RETRY_GRADLE_PLUGIN_RESOLUTION: '0', ...overrides },
    })
    return { ...result, count: Number(readFileSync(join(dir, 'count'), 'utf8')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
test('transient HTTP 504 is retried and the completed command must succeed', () => {
  const r = runScenario(2, 'Response code 504 (Gateway Time-out)')
  assert.equal(r.status, 0)
  assert.equal(r.count, 3)
  assert.match(r.stdout, /verified build/)
})
test('compiler errors cannot trigger a retry', () => {
  const r = runScenario(3, 'error TS2304: cannot find name')
  assert.equal(r.status, 14)
  assert.equal(r.count, 1)
})
test('three HTTP 504 failures still fail the required build', () => {
  const r = runScenario(3, 'Server returned HTTP response code: 504')
  assert.equal(r.status, 14)
  assert.equal(r.count, 3)
})

const kotlinPluginUnavailable = "Plugin [id: 'org.jetbrains.kotlin.android', version: '2.1.20', apply: false] was not found in any of the following sources:"

test('Gradle plugin resolution is not retried without explicit opt-in', () => {
  const r = runScenario(3, kotlinPluginUnavailable)
  assert.equal(r.status, 14)
  assert.equal(r.count, 1)
})
test('explicit Kotlin Gradle plugin resolution retry recovers a transient repository outage', () => {
  const r = runScenario(2, kotlinPluginUnavailable, { XDRIVE_CI_RETRY_GRADLE_PLUGIN_RESOLUTION: '1' })
  assert.equal(r.status, 0)
  assert.equal(r.count, 3)
  assert.match(r.stderr, /Kotlin Gradle plugin resolution, retry/)
})
test('persistent Kotlin Gradle plugin resolution failure remains fatal after three attempts', () => {
  const r = runScenario(3, kotlinPluginUnavailable, { XDRIVE_CI_RETRY_GRADLE_PLUGIN_RESOLUTION: '1' })
  assert.equal(r.status, 14)
  assert.equal(r.count, 3)
})
test('compiler failures remain fatal with Kotlin plugin retry enabled', () => {
  const r = runScenario(3, 'e: /app/src/Foo.kt:42:9 Unresolved reference', { XDRIVE_CI_RETRY_GRADLE_PLUGIN_RESOLUTION: '1' })
  assert.equal(r.status, 14)
  assert.equal(r.count, 1)
})

// Exact GitHub CI failure: Maven Central reset during Kotlin Gradle plugin
// artifact download. This is not a Kotlin compiler or dependency-version error.
const mavenReset = [
  '> Could not resolve all artifacts for configuration \'classpath\'.',
  '  > Could not download kotlin-gradle-plugin-2.1.20-gradle85.jar (org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20)',
  "    > Could not get resource 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/2.1.20/kotlin-gradle-plugin-2.1.20-gradle85.jar'.",
  '      > Connection reset',
].join('\n')

test('Kotlin Maven Central jar transfer reset is retried and must eventually succeed', () => {
  const r = runScenario(2, mavenReset)
  assert.equal(r.status, 0)
  assert.equal(r.count, 3)
  assert.match(r.stderr, /Kotlin Maven Central jar connection reset, retry/)
})
test('persistent Kotlin Maven jar connection resets still fail required Android build', () => {
  const r = runScenario(3, mavenReset)
  assert.equal(r.status, 14)
  assert.equal(r.count, 3)
  assert.match(r.stderr, /transient download still unavailable/)
})
test('bare connection reset without exact Maven Kotlin jar transfer is terminal', () => {
  const r = runScenario(3, "A problem occurred configuring project: java.net.SocketException: Connection reset")
  assert.equal(r.status, 14)
  assert.equal(r.count, 1)
})
test('Kotlin dependency resolution failure without external reset remains terminal', () => {
  const r = runScenario(3, 'Could not download kotlin-gradle-plugin-2.1.20-gradle85.jar: artifact missing')
  assert.equal(r.status, 14)
  assert.equal(r.count, 1)
})
