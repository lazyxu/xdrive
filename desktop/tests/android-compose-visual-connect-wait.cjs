'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname,
  '../../android/app/src/androidTest/java/com/tfluid/xdrive/VisualParityTest.kt'), 'utf8')
const app = fs.readFileSync(path.join(__dirname,
  '../../android/app/src/main/java/com/tfluid/xdrive/DriveApp.kt'), 'utf8')
const screens = fs.readFileSync(path.join(__dirname,
  '../../android/app/src/main/java/com/tfluid/xdrive/AuthScreens.kt'), 'utf8')
const start = src.indexOf('    private fun loginScreen(')
const end = src.indexOf('    private fun login()', start)
const fixture = src.slice(start, end)

test('Android narrow-large-font fixture uses one-page Server and credentials, without obsolete connect click', () => {
  assert.ok(start >= 0 && end > start)
  const entered = fixture.indexOf('compose.onNodeWithTag("server").assertTextEquals("https://drive.example")')
  const visible = fixture.indexOf('compose.onNodeWithTag("username").assertExists()')
  const resize = fixture.indexOf('compactViewport = true')
  assert.ok(entered >= 0 && entered < visible && visible < resize)
  assert.equal(fixture.includes('compose.awaitFixtureConnectLogin'), false)
  assert.equal(fixture.includes('compose.onNodeWithTag("auth-submit").performScrollTo().performClick()'), false)
  assert.match(app, /Screen\.CONNECT, Screen\.LOGIN -> UnifiedLoginForm/)
  assert.match(screens, /AuthField\("服务器",/)
  assert.match(screens, /AuthField\("用户名",/)
  assert.match(screens, /AuthField\("密码",/)
  assert.match(src, /@Test fun narrowLargeFontSubmitRemainsReachable\(\)/)
  assert.match(src, /compose.onNodeWithText\("登录"\)\.performScrollTo\(\)\.assertIsDisplayed\(\)/)
})
