'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const src=fs.readFileSync(path.join(__dirname,
  '../../android/app/src/androidTest/java/com/tfluid/xdrive/VisualParityTest.kt'),'utf8')
const readiness=fs.readFileSync(path.join(__dirname,
  '../../android/app/src/androidTest/java/com/tfluid/xdrive/FixtureConnectReadiness.kt'),'utf8')
const start=src.indexOf('    private fun loginScreen(')
const end=src.indexOf('    private fun login()',start)
const fixture=src.slice(start,end)
test('Android narrow-large-font visual fixture waits for actual asynchronous Connect to Login state',()=>{
  assert.ok(start>=0&&end>start)
  const entered=fixture.indexOf('compose.onNodeWithTag("server").assertTextEquals("https://drive.example")')
  const click=fixture.indexOf('compose.onNodeWithTag("auth-submit").performScrollTo().performClick()')
  const wait=fixture.indexOf('compose.awaitFixtureConnectLogin(controller) { connectFactoryCalls.get() }')
  const visible=fixture.indexOf('compose.onNodeWithTag("username").assertExists()',wait)
  const resize=fixture.indexOf('compactViewport = true',wait)
  assert.ok(entered>=0&&entered<click&&click<wait&&wait<visible&&visible<resize)
  // The actual strict 10s LOGIN transition is now shared, not deleted.
  const realWait=readiness.indexOf('waitUntil(timeoutMillis = 10_000)')
  const realLogin=readiness.indexOf('controller.state.value.screen == Screen.LOGIN',realWait)
  const realIdle=readiness.indexOf('waitForIdle()',realLogin)
  assert.ok(realWait>=0&&realWait<realLogin&&realLogin<realIdle)
  // AndroidX ComposeTimeoutException directly extends Throwable, NOT Exception.
  // A broad Exception catch never records timeout diagnostics on real CI failures.
  assert.match(readiness,/import androidx\.compose\.ui\.test\.ComposeTimeoutException/)
  assert.match(readiness,/catch \(failure: ComposeTimeoutException\)/)
  assert.doesNotMatch(readiness,/catch \(failure: Exception\)/)
  assert.match(readiness,/throw AssertionError\(/)
  assert.match(readiness,/serviceFactoryCalls\(\)/)
  assert.match(readiness,/errorPresent=/)
  assert.match(src,/@Test fun narrowLargeFontSubmitRemainsReachable\(\)/)
  assert.match(src,/compose.onNodeWithText\("登录"\)\.performScrollTo\(\)\.assertIsDisplayed\(\)/)
})
