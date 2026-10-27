#!/usr/bin/env node
'use strict'
// Genuine production React Web UI -> same-origin HTTPS -> production Gin and
// isolated PostgreSQL 17. No route.fulfill, fetch mocks or test credentials in
// evidence. This is not Safari/iOS physical-device or production TLS trust.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium, request } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(ready|output-dir)=(.+)$/.exec(value)
  assert(match, 'Expected --ready and --output-dir')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'])
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert.equal(ready.cookie_https, true, 'S2B3 must opt in to real local TLS')
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.intercepted_api, false)
assert.equal(ready.physical_device, false)
assert(/^https:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
assert.equal(ready.username, 'pwa-s2b3-owner')
assert(Number.isSafeInteger(ready.target_id) && ready.target_id > 0)
assert.equal(ready.password_username, 'pwa-cookie-password-user')
assert.equal(ready.admin_username, 'pwa-cookie-admin')
assert(Number.isSafeInteger(ready.password_user_id) && ready.password_user_id > 0)
const executable = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(executable && fs.existsSync(executable), 'System Chrome is required')
const out = path.resolve(args['output-dir'])
fs.mkdirSync(out, { recursive: true })
const origin = ready.url
const folderPath = '/api/v1/nodes/' + ready.target_id
const browserLogin = '/api/v1/auth/browser/login'
const browserRefresh = '/api/v1/auth/browser/refresh'
const browserLogout = '/api/v1/auth/browser/logout'
const deepLink = '#/app/files?dir=' + ready.target_id
const summary = {
  suite: 'production-Web-UI-HTTPS-Gin-PostgreSQL-cookie',
  realWebUI: true, realGin: true, realPostgreSQL: true, realHTTPS: true,
  apiMocks: false, ephemeralUntrustedTestCertificate: true,
  installedPWA: false, physicalSafari: false,
  loginFromUI: false, secureHttpOnly: false, accessMemoryOnly: false,
  privateBearerRead: false, cookieNotBearer: false, coldRestore: false,
  twoTabRestore: false, wrongOwnerRejected: false,
  logoutFromUI: false, postLogoutFailClosed: false,
  forcedPasswordForm: false, passwordCookieRotated: false,
  stalePasswordJWTRejected: false, stalePasswordCookieRejected: false,
  passwordColdRestore: false, oldPasswordRejected: false,
  newPasswordAccepted: false, adminRevoke204: false,
  adminRevokedJWT: false, adminRevokedCookie: false,
  adminRevokedBrowserUI: false,
  passed: false, failedAt: null,
}
let checkpoint = 'startup'
const matches = pathname => response =>
  new URL(response.url()).pathname === pathname
const isResponse = (pathname, method, status) => response =>
  matches(pathname)(response) &&
  response.request().method() === method && response.status() === status
async function inspectPrivateStorage(page) {
  return page.evaluate(() => ({
    mode: localStorage.getItem('xdrive.auth_cookie_mode'),
    owner: localStorage.getItem('xdrive.username'),
    tokenStored: [
      'xdrive.access_token', 'xdrive.token',
      'xdrive.refresh_token', 'xdrive.access_expires_at',
    ].some(key => localStorage.getItem(key) !== null),
    cookieVisible: document.cookie.includes('__Host-xdrive_refresh'),
  }))
}
function requirePrivateState(state) {
  assert.equal(state.mode, 'cookie')
  assert.equal(state.owner, ready.username)
  assert.equal(state.tokenStored, false, 'Cookie mode must never persist JWT')
  assert.equal(state.cookieVisible, false, 'HttpOnly must hide refresh from JS')
}
async function refreshCookie(context) {
  return (await context.cookies(origin)).find(c => c.name === '__Host-xdrive_refresh')
}
async function main() {
  let browser
  let context
  let passwordContext
  let adminRequest
  try {
    browser = await chromium.launch({
      executablePath: executable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    // Only isolated httptest.NewTLSServer has a self-signed certificate.
    // Never change product TLS verification or trust an external host.
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    await page.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await page.locator('#web-login-username').waitFor()
    assert.equal(new URL(page.url()).hash, deepLink)
    assert.equal(await page.evaluate(() => window.isSecureContext), true)
    assert.equal(await page.evaluate(() => typeof navigator.locks?.request), 'function')
    assert.equal(await page.getByRole('checkbox', { name: '保持登录' }).isChecked(), true)

    checkpoint = 'real-web-ui-cookie-login'
    const loginResponse = page.waitForResponse(isResponse(browserLogin, 'POST', 200))
    const ownerRead = page.waitForResponse(isResponse(folderPath, 'GET', 200))
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    const issued = await loginResponse
    const loginJSON = await issued.json()
    assert.equal(loginJSON.browser_session, true)
    assert.equal(loginJSON.refresh_token || '', '')
    assert.equal(typeof loginJSON.access_token, 'string')
    assert(loginJSON.access_token.length > 16)
    assert.match(issued.headers()['cache-control'] || '', /no-store/i)
    await ownerRead
    await page.locator('#web-login-username').waitFor({ state: 'detached' })
    assert.equal(new URL(page.url()).hash, deepLink)
    summary.loginFromUI = true
    summary.privateBearerRead = true

    const firstCookie = await refreshCookie(context)
    assert(firstCookie?.secure && firstCookie.httpOnly && firstCookie.sameSite === 'Strict')
    assert.equal(firstCookie.path, '/')
    requirePrivateState(await inspectPrivateStorage(page))
    summary.secureHttpOnly = true
    summary.accessMemoryOnly = true

    checkpoint = 'cookie-is-not-bearer'
    // The browser sends its HttpOnly cookie, but a private Node still needs
    // a short-lived Bearer. A leaked ambient cookie must not authorize it.
    const bareRead = await page.evaluate(async folderID => {
      const response = await fetch('/api/v1/nodes/' + folderID, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      return response.status
    }, ready.target_id)
    assert.equal(bareRead, 401)
    summary.cookieNotBearer = true

    checkpoint = 'real-UI-cold-cookie-restore'
    const coldRefresh = page.waitForResponse(isResponse(browserRefresh, 'POST', 200))
    const coldPrivateRead = page.waitForResponse(isResponse(folderPath, 'GET', 200))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await coldRefresh
    await coldPrivateRead
    assert.equal(await page.locator('#web-login-username').count(), 0)
    requirePrivateState(await inspectPrivateStorage(page))
    const secondCookie = await refreshCookie(context)
    assert(secondCookie?.value && secondCookie.value !== firstCookie.value,
      'real Gin must rotate the refresh cookie on cold boot')
    summary.coldRestore = true

    checkpoint = 'real-UI-two-tab-rotation'
    const [left, right] = await Promise.all([context.newPage(), context.newPage()])
    left.setDefaultTimeout(30000)
    right.setDefaultTimeout(30000)
    const both = [left, right].map(tab => ({
      refresh: tab.waitForResponse(isResponse(browserRefresh, 'POST', 200)),
      folder: tab.waitForResponse(isResponse(folderPath, 'GET', 200)),
    }))
    await Promise.all([left, right].map(tab =>
      tab.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })))
    await Promise.all(both.flatMap(result => [result.refresh, result.folder]))
    for (const tab of [left, right]) {
      assert.equal(await tab.locator('#web-login-username').count(), 0)
      requirePrivateState(await inspectPrivateStorage(tab))
    }
    summary.twoTabRestore = true

    checkpoint = 'real-Gin-wrong-Owner-no-rotation'
    const beforeWrongOwner = await refreshCookie(context)
    const wrongOwnerStatus = await left.evaluate(async () => {
      const response = await fetch('/api/v1/auth/browser/refresh', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'X-XDrive-Browser-Owner': 'pwa-s2b3-foreign' },
      })
      return response.status
    })
    assert.equal(wrongOwnerStatus, 409)
    assert.equal((await refreshCookie(context))?.value, beforeWrongOwner.value,
      'rejected cross-Owner POST must not consume a valid Cookie')
    summary.wrongOwnerRejected = true

    // Granular, secret-free stages distinguish UI selector, HTTP and local
    // revocation failure. Never loosen the 204 or cleared-Cookie contract.
    checkpoint = 'logout-avatar-button'
    summary.logoutAvatarButtons = await page.getByRole('button',
      { name: '账户菜单' }).count()
    assert(summary.logoutAvatarButtons > 0, 'account avatar must remain mounted')
    await page.getByRole('button', { name: '账户菜单' }).first().click()
    checkpoint = 'logout-menu-item'
    const logoutItem = page.getByRole('menuitem', { name: '退出登录' })
    await logoutItem.waitFor({ state: 'visible' })
    checkpoint = 'logout-post-response'
    const logoutResponse = page.waitForResponse(response =>
      matches(browserLogout)(response) && response.request().method() === 'POST')
    await logoutItem.click()
    const actualLogout = await logoutResponse
    summary.logoutHTTPStatus = actualLogout.status()
    assert.equal(summary.logoutHTTPStatus, 204,
      'real Gin must acknowledge browser logout with HTTP 204')
    checkpoint = 'logout-login-screen'
    await page.locator('#web-login-username').waitFor()
    checkpoint = 'logout-cookie-evicted'
    assert.equal(await refreshCookie(context), undefined)
    summary.logoutFromUI = true

    checkpoint = 'fresh-tab-after-logout'
    const after = await context.newPage()
    await after.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await after.locator('#web-login-username').waitFor()
    const stale = await after.evaluate(() => ({
      mode: localStorage.getItem('xdrive.auth_cookie_mode'),
      tokens: ['xdrive.access_token', 'xdrive.refresh_token', 'xdrive.token']
        .some(key => localStorage.getItem(key) !== null),
    }))
    assert.equal(stale.mode, null)
    assert.equal(stale.tokens, false)
    assert.equal((await refreshCookie(context)), undefined)
    summary.postLogoutFailClosed = true

    // Separate fixture Owner; never mutate the baseline user's accepted
    // Gallery/Files behavior. This is a second genuine browser UI flow.
    checkpoint = 'real-UI-password-forced-login'
    passwordContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
    })
    const passwordPage = await passwordContext.newPage()
    passwordPage.setDefaultTimeout(30000)
    await passwordPage.goto(origin + '/#/app/files', { waitUntil: 'domcontentloaded' })
    await passwordPage.locator('#web-login-username').waitFor()
    const passwordLogin = passwordPage.waitForResponse(
      isResponse(browserLogin, 'POST', 200))
    await passwordPage.locator('#web-login-username').fill(ready.password_username)
    await passwordPage.locator('#web-login-password').fill('PwaCookieOld-TestOnly_2026!')
    await passwordPage.getByRole('button', { name: '登录', exact: true }).click()
    const firstPasswordSession = await (await passwordLogin).json()
    assert.equal(firstPasswordSession.browser_session, true)
    assert.equal(firstPasswordSession.refresh_token || '', '')
    const oldAccess = firstPasswordSession.access_token
    assert(typeof oldAccess === 'string' && oldAccess.length > 16)
    await passwordPage.getByRole('heading',
      { name: '修改临时密码', exact: true }).waitFor()
    const passwordCookieBefore = await refreshCookie(passwordContext)
    assert(passwordCookieBefore?.httpOnly && passwordCookieBefore.secure)
    summary.forcedPasswordForm = true

    checkpoint = 'real-UI-password-change-200'
    const passwordChangeResponse = passwordPage.waitForResponse(
      isResponse('/api/v1/me/change-password/browser', 'POST', 200))
    await passwordPage.locator('#xdrive-current-password')
      .fill('PwaCookieOld-TestOnly_2026!')
    await passwordPage.locator('#xdrive-new-password')
      .fill('PwaCookieNew-TestOnly_2026!')
    await passwordPage.locator('#xdrive-confirm-password')
      .fill('PwaCookieNew-TestOnly_2026!')
    await passwordPage.getByRole('button',
      { name: '修改密码', exact: true }).click()
    const changed = await (await passwordChangeResponse).json()
    assert.equal(changed.browser_session, true)
    assert.equal(changed.refresh_token || '', '')
    const changedAccess = changed.access_token
    assert(typeof changedAccess === 'string' && changedAccess.length > 16)
    const passwordCookieAfter = await refreshCookie(passwordContext)
    assert(passwordCookieAfter?.httpOnly && passwordCookieAfter.secure)
    assert.notEqual(passwordCookieAfter.value, passwordCookieBefore.value,
      'password change must rotate real Gin HttpOnly refresh cookie')
    await passwordPage.getByRole('heading',
      { name: '修改临时密码', exact: true }).waitFor({ state: 'detached' })
    const changedStorage = await inspectPrivateStorage(passwordPage)
    assert.equal(changedStorage.owner, ready.password_username)
    assert.equal(changedStorage.mode, 'cookie')
    assert.equal(changedStorage.cookieVisible, false)
    assert.equal(changedStorage.tokenStored, false)
    summary.passwordCookieRotated = true

    // Network security negatives use an independent HTTP client, without
    // overriding a browser's HttpOnly cookie or modifying production JS.
    adminRequest = await request.newContext({ ignoreHTTPSErrors: true })
    checkpoint = 'old-password-session-replay'
    const oldJWT = await adminRequest.get(origin + '/api/v1/me', {
      headers: { Authorization: 'Bearer ' + oldAccess },
    })
    assert.equal(oldJWT.status(), 401)
    summary.stalePasswordJWTRejected = true
    const replay = await adminRequest.post(origin + browserRefresh, {
      headers: {
        Origin: origin,
        'X-XDrive-Browser-Owner': ready.password_username,
        Cookie: '__Host-xdrive_refresh=' + passwordCookieBefore.value,
      },
    })
    assert.equal(replay.status(), 401)
    assert.equal((await refreshCookie(passwordContext))?.value,
      passwordCookieAfter.value)
    summary.stalePasswordCookieRejected = true

    checkpoint = 'new-password-cold-restore'
    const passwordColdRefresh = passwordPage.waitForResponse(
      isResponse(browserRefresh, 'POST', 200))
    await passwordPage.reload({ waitUntil: 'domcontentloaded' })
    await passwordColdRefresh
    assert.equal(await passwordPage.locator('#web-login-username').count(), 0)
    const afterPasswordReload = await inspectPrivateStorage(passwordPage)
    assert.equal(afterPasswordReload.owner, ready.password_username)
    assert.equal(afterPasswordReload.mode, 'cookie')
    assert.equal(afterPasswordReload.tokenStored, false)
    summary.passwordColdRestore = true

    checkpoint = 'password-credential-rejection'
    const oldPasswordLogin = await adminRequest.post(origin + '/api/v1/auth/login', {
      data: {
        username: ready.password_username,
        password: 'PwaCookieOld-TestOnly_2026!',
      },
    })
    assert.equal(oldPasswordLogin.status(), 401)
    summary.oldPasswordRejected = true
    const validPasswordLogin = await adminRequest.post(origin + '/api/v1/auth/login', {
      data: {
        username: ready.password_username,
        password: 'PwaCookieNew-TestOnly_2026!',
      },
    })
    assert.equal(validPasswordLogin.status(), 200)
    summary.newPasswordAccepted = true

    // Real admin login + the ACTUAL protected admin Gin route, not a test
    // backdoor that simply increments SessionVersion in fixture SQL.
    checkpoint = 'real-admin-revoke-sessions'
    const adminLogin = await adminRequest.post(origin + '/api/v1/auth/login', {
      data: {
        username: ready.admin_username,
        password: 'PwaCookieAdmin-TestOnly_2026!',
      },
    })
    assert.equal(adminLogin.status(), 200)
    const adminJSON = await adminLogin.json()
    assert.equal(adminJSON.role, 'admin')
    assert(typeof adminJSON.access_token === 'string' &&
      adminJSON.access_token.length > 16)
    const revocation = await adminRequest.post(
      origin + '/api/v1/admin/users/' + ready.password_user_id + '/revoke-sessions', {
        headers: { Authorization: 'Bearer ' + adminJSON.access_token },
      })
    assert.equal(revocation.status(), 204)
    summary.adminRevoke204 = true

    checkpoint = 'admin-revoked-jwt-and-cookie'
    const revokedAccess = await adminRequest.get(origin + '/api/v1/me', {
      headers: { Authorization: 'Bearer ' + changedAccess },
    })
    assert.equal(revokedAccess.status(), 401)
    summary.adminRevokedJWT = true
    const revokedRefresh = passwordPage.waitForResponse(
      isResponse(browserRefresh, 'POST', 401))
    await passwordPage.reload({ waitUntil: 'domcontentloaded' })
    await revokedRefresh
    summary.adminRevokedCookie = true
    await passwordPage.locator('#web-login-username').waitFor()
    assert.equal(await passwordPage.getByRole('heading',
      { name: '修改临时密码', exact: true }).count(), 0)
    const afterRevokeStorage = await inspectPrivateStorage(passwordPage)
    assert.equal(afterRevokeStorage.tokenStored, false)
    summary.adminRevokedBrowserUI = true

    checkpoint = 'finish-isolated-real-Gin'
    const finished = await after.evaluate(async () =>
      (await fetch('/__test/pwa-s2b3/finish', { method: 'POST' })).status)
    assert.equal(finished, 204)
    summary.passed = true
  } catch (error) {
    summary.failedAt = checkpoint
    // Never print real access/refresh JWTs, Cookie values, request headers,
    // passwords, browser storage, full Playwright traces, or stack dumps.
    console.error('Cookie UI E2E failed at ' + checkpoint + ' [' +
      String(error?.name || 'Error').slice(0, 60) + ']')
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('COOKIE_UI_REAL_GIN_EVIDENCE ' + JSON.stringify(summary))
    await adminRequest?.dispose()
    await passwordContext?.close()
    await context?.close()
    await browser?.close()
  }
}
main().catch(() => { process.exitCode = 1 })
