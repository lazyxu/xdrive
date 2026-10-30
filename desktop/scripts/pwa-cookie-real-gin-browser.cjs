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
  legacyJSONUpgradePreserved: false, legacyJSONColdRestore: false,
  legacyJSONLogout204: false, legacyCookieOnReauthentication: false,
  legacyCookieColdRestore: false,
  offlineLogoutLocalImmediate: false, offlineLogoutTombstoneRetained: false,
  offlineRestartNoPrivateRestore: false, onlineTombstoneRemoteRevoked: false,
  offlineOldRefreshRejected: false,
  restrictedLockGetterFallback: false, restrictedLockRequestFallback: false,
  deniedStorageMemoryOnly: false, deniedStorageNoOwnerlessRefresh: false,
  deniedStoragePageErrors: [],
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
  let legacyContext
  let offlineContext
  const capabilityContexts = []
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
    // Diagnose this real Gin UI transition without ever recording JWTs,
    // cookies, credentials, response bodies, private paths or user content.
    // This does NOT turn a failed forced-password flow into a passing test.
    const passwordLoginTrace = []
    const passwordPageErrors = []
    passwordPage.on('response', response => {
      const pathname = new URL(response.url()).pathname
      if (pathname !== '/api/v1/me' &&
          pathname !== browserLogin && pathname !== browserRefresh) return
      if (passwordLoginTrace.length >= 12) return
      passwordLoginTrace.push({ route: pathname, status: response.status() })
    })
    passwordPage.on('pageerror', error => {
      if (passwordPageErrors.length < 5) passwordPageErrors.push(error.name)
    })
    passwordPage.setDefaultTimeout(30000)
    checkpoint = 'forced-login-open-page'
    await passwordPage.goto(origin + '/#/app/files', { waitUntil: 'domcontentloaded' })
    checkpoint = 'forced-login-await-form'
    await passwordPage.locator('#web-login-username').waitFor()
    const passwordLogin = passwordPage.waitForResponse(response =>
      matches(browserLogin)(response) && response.request().method() === 'POST')
    checkpoint = 'forced-login-submit'
    await passwordPage.locator('#web-login-username').fill(ready.password_username)
    await passwordPage.locator('#web-login-password').fill('PwaCookieOld-TestOnly_2026!')
    await passwordPage.getByRole('button', { name: '登录', exact: true }).click()
    checkpoint = 'forced-login-http-status'
    const passwordResponse = await passwordLogin
    assert.equal(passwordResponse.status(), 200,
      'temporary-password Owner must authenticate through the real Gin endpoint')
    const firstPasswordSession = await passwordResponse.json()
    assert.equal(firstPasswordSession.browser_session, true)
    assert.equal(firstPasswordSession.refresh_token || '', '')
    const oldAccess = firstPasswordSession.access_token
    assert(typeof oldAccess === 'string' && oldAccess.length > 16)
    checkpoint = 'forced-login-required-password-form'
    try {
      await passwordPage.getByRole('heading',
        { name: '修改临时密码', exact: true }).waitFor()
    } catch (error) {
      // Persist only redacted state/HTTP status evidence; never dump DOM,
      // access token, Cookie, HTTP response body or submitted password.
      summary.forcedPasswordDiagnostics = {
        authRoutes: passwordLoginTrace,
        pageErrorTypes: passwordPageErrors,
        loginFormPresent: (await passwordPage.locator('#web-login-username').count()) > 0,
        changeFormPresent: (await passwordPage.locator('#xdrive-current-password').count()) > 0,
        filesWorkspacePresent: (await passwordPage.locator('[data-xdrive-files-workspace]').count()) > 0,
        locationIsFiles: new URL(passwordPage.url()).hash === '#/app/files',
      }
      throw error
    }
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

    // Upgrade an ACTUAL previously issued native/legacy JSON session: no
    // fabricated JWT and no browser Cookie mode on the initial cold boot.
    // Product policy is to preserve a valid legacy session until the next
    // interactive login, not forcibly expire it at upgrade time.
    checkpoint = 'legacy-JSON-credential-fixture'
    const legacyLogin = await adminRequest.post(origin + '/api/v1/auth/login', {
      data: {
        username: ready.username,
        password: 'PwaRealGin-TestOnly_2026!',
      },
    })
    assert.equal(legacyLogin.status(), 200)
    const legacySession = await legacyLogin.json()
    assert(typeof legacySession.access_token === 'string' &&
      legacySession.access_token.length > 16)
    assert(typeof legacySession.refresh_token === 'string' &&
      legacySession.refresh_token.length > 16)
    assert.notEqual(legacySession.browser_session, true)
    legacyContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
    })
    const legacyPage = await legacyContext.newPage()
    legacyPage.setDefaultTimeout(30000)
    await legacyPage.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await legacyPage.locator('#web-login-username').waitFor()
    // Model pre-upgrade durable localStorage, using credentials issued by
    // genuine Gin /auth/login, then restart actual React on that same origin.
    await legacyPage.evaluate(session => {
      localStorage.setItem('xdrive.remember_login', 'true')
      localStorage.setItem('xdrive.username', session.username)
      localStorage.setItem('xdrive.last_username', session.username)
      localStorage.setItem('xdrive.access_token', session.access_token)
      localStorage.setItem('xdrive.token', session.access_token)
      localStorage.setItem('xdrive.refresh_token', session.refresh_token)
      localStorage.setItem('xdrive.access_expires_at',
        String(Date.now() + Number(session.expires_in) * 1000))
      localStorage.removeItem('xdrive.auth_cookie_mode')
    }, legacySession)
    checkpoint = 'legacy-JSON-restore-on-upgraded-HTTPS-Web'
    const legacyPrivateRead = legacyPage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    await legacyPage.reload({ waitUntil: 'domcontentloaded' })
    await legacyPrivateRead
    assert.equal(await legacyPage.locator('#web-login-username').count(), 0)
    const oldStorage = await inspectPrivateStorage(legacyPage)
    assert.equal(oldStorage.mode, null)
    assert.equal(oldStorage.owner, ready.username)
    assert.equal(oldStorage.tokenStored, true, 'valid pre-upgrade JSON session must survive')
    assert.equal(oldStorage.cookieVisible, false)
    assert.equal(await refreshCookie(legacyContext), undefined)
    summary.legacyJSONUpgradePreserved = true

    checkpoint = 'legacy-JSON-second-cold-reload'
    const legacyReadAgain = legacyPage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    await legacyPage.reload({ waitUntil: 'domcontentloaded' })
    await legacyReadAgain
    assert.equal(await legacyPage.locator('#web-login-username').count(), 0)
    assert.equal((await inspectPrivateStorage(legacyPage)).tokenStored, true)
    summary.legacyJSONColdRestore = true

    // Explicit logout and fresh login is the documented migration boundary:
    // legacy JSON is revoked and only the new HttpOnly Cookie remains durable.
    checkpoint = 'legacy-JSON-explicit-logout'
    const oldLogoutResponse = legacyPage.waitForResponse(
      isResponse('/api/v1/auth/logout', 'POST', 204))
    await legacyPage.getByRole('button',
      { name: '账户菜单' }).first().click()
    await legacyPage.getByRole('menuitem',
      { name: '退出登录' }).click()
    await oldLogoutResponse
    await legacyPage.locator('#web-login-username').waitFor()
    const signedOutLegacy = await inspectPrivateStorage(legacyPage)
    assert.equal(signedOutLegacy.tokenStored, false)
    assert.equal(await refreshCookie(legacyContext), undefined)
    summary.legacyJSONLogout204 = true

    checkpoint = 'legacy-to-Cookie-interactive-login'
    const legacyToCookie = legacyPage.waitForResponse(
      isResponse(browserLogin, 'POST', 200))
    const legacyCookiePrivateRead = legacyPage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    await legacyPage.locator('#web-login-username').fill(ready.username)
    await legacyPage.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    assert.equal(await legacyPage.getByRole('checkbox',
      { name: '保持登录' }).isChecked(), true)
    await legacyPage.getByRole('button',
      { name: '登录', exact: true }).click()
    const upgradedResponse = await legacyToCookie
    const upgradedBody = await upgradedResponse.json()
    assert.equal(upgradedBody.browser_session, true)
    assert.equal(upgradedBody.refresh_token || '', '')
    await legacyCookiePrivateRead
    requirePrivateState(await inspectPrivateStorage(legacyPage))
    const upgradedCookie = await refreshCookie(legacyContext)
    assert(upgradedCookie?.httpOnly && upgradedCookie.secure)
    summary.legacyCookieOnReauthentication = true

    checkpoint = 'upgraded-legacy-Cookie-cold-restore'
    const upgradedRefresh = legacyPage.waitForResponse(
      isResponse(browserRefresh, 'POST', 200))
    const upgradedRead = legacyPage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    await legacyPage.reload({ waitUntil: 'domcontentloaded' })
    await upgradedRefresh
    await upgradedRead
    requirePrivateState(await inspectPrivateStorage(legacyPage))
    assert.notEqual((await refreshCookie(legacyContext))?.value,
      upgradedCookie.value, 'new cookie must rotate after cold restore')
    summary.legacyCookieColdRestore = true

    // Offline sign-out is a CLIENT transport fault, not a mocked API success.
    // The actual Gin server remains available to the browser for page assets.
    // Block ONLY the outgoing authenticated Cookie logout HTTP POST and assert
    // the durable tombstone fences all accidental refresh on two cold boots.
    checkpoint = 'offline-logout-login-real-Gin'
    offlineContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
    })
    const offlinePage = await offlineContext.newPage()
    offlinePage.setDefaultTimeout(30000)
    await offlinePage.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await offlinePage.locator('#web-login-username').waitFor()
    const offlineLogin = offlinePage.waitForResponse(
      isResponse(browserLogin, 'POST', 200))
    const offlineRead = offlinePage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    await offlinePage.locator('#web-login-username').fill(ready.username)
    await offlinePage.locator('#web-login-password')
      .fill('PwaRealGin-TestOnly_2026!')
    await offlinePage.getByRole('button', { name: '登录', exact: true }).click()
    await offlineLogin
    await offlineRead
    const offlineCookieBefore = await refreshCookie(offlineContext)
    assert(offlineCookieBefore?.httpOnly && offlineCookieBefore.secure)
    let offlineDropped = 0
    let unauthorizedRestores = 0
    offlinePage.on('request', request => {
      if (request.method() === 'POST' &&
        new URL(request.url()).pathname === browserRefresh) {
        unauthorizedRestores++
      }
    })
    const logoutRoute = '**/api/v1/auth/browser/logout'
    await offlineContext.route(logoutRoute, async route => {
      if (route.request().method() !== 'POST') return route.continue()
      offlineDropped++
      await route.abort('internetdisconnected')
    })
    checkpoint = 'offline-logout-local-clear'
    const firstDrop = offlinePage.waitForEvent('requestfailed', {
      predicate: req => new URL(req.url()).pathname === browserLogout &&
        req.method() === 'POST',
    })
    await offlinePage.getByRole('button', { name: '账户菜单' }).first().click()
    await offlinePage.getByRole('menuitem', { name: '退出登录' }).click()
    await offlinePage.locator('#web-login-username').waitFor()
    const localSignout = await offlinePage.evaluate(() => ({
      marker: localStorage.getItem('xdrive.auth_cookie_logout_pending'),
      owner: localStorage.getItem('xdrive.auth_cookie_logout_owner'),
      mode: localStorage.getItem('xdrive.auth_cookie_mode'),
      tokensPresent: [
        'xdrive.access_token', 'xdrive.refresh_token', 'xdrive.token',
      ].some(key => localStorage.getItem(key) !== null),
    }))
    assert.match(localSignout.marker || '', /^1(?::|$)/)
    assert.equal(localSignout.owner, ready.username)
    assert.equal(localSignout.mode, null)
    assert.equal(localSignout.tokensPresent, false)
    summary.offlineLogoutLocalImmediate = true
    await firstDrop
    assert.equal(offlineDropped, 1)
    assert.equal((await refreshCookie(offlineContext)).value,
      offlineCookieBefore.value, 'network failure must not fake server revocation')
    summary.offlineLogoutTombstoneRetained = true

    checkpoint = 'offline-restart-still-tombstoned'
    const secondDrop = offlinePage.waitForEvent('requestfailed', {
      predicate: req => new URL(req.url()).pathname === browserLogout &&
        req.method() === 'POST',
    })
    await offlinePage.reload({ waitUntil: 'domcontentloaded' })
    await secondDrop
    await offlinePage.locator('#web-login-username').waitFor()
    assert.equal(await offlinePage.evaluate(() =>
      localStorage.getItem('xdrive.auth_cookie_logout_pending')),
    localSignout.marker, 'failed remote acknowledgement must not erase tombstone')
    assert.equal(await offlinePage.evaluate(() =>
      localStorage.getItem('xdrive.auth_cookie_logout_owner')), ready.username)
    assert.equal(unauthorizedRestores, 0,
      'pending logout must never attempt ambient Cookie refresh')
    assert.equal(offlineDropped, 2)
    summary.offlineRestartNoPrivateRestore = true

    checkpoint = 'network-recovered-logout-204'
    await offlineContext.unroute(logoutRoute)
    const recoveredLogout = offlinePage.waitForResponse(
      isResponse(browserLogout, 'POST', 204))
    await offlinePage.reload({ waitUntil: 'domcontentloaded' })
    await recoveredLogout
    await offlinePage.locator('#web-login-username').waitFor()
    await offlinePage.waitForFunction(() =>
      localStorage.getItem('xdrive.auth_cookie_logout_pending') === null)
    assert.equal(await offlinePage.evaluate(() =>
      localStorage.getItem('xdrive.auth_cookie_logout_owner')), null)
    assert.equal(await refreshCookie(offlineContext), undefined)
    assert.equal(unauthorizedRestores, 0)
    // The old refresh credential must be rejected by production Gin/SQL,
    // rather than merely deleted from the browser Cookie Jar.
    const offlineServerReplay = await adminRequest.post(origin + browserRefresh, {
      headers: {
        Origin: origin,
        'X-XDrive-Browser-Owner': ready.username,
        Cookie: '__Host-xdrive_refresh=' + offlineCookieBefore.value,
      },
    })
    assert.equal(offlineServerReplay.status(), 401,
      'real Gin must revoke the pending Cookie at the server')
    summary.offlineOldRefreshRejected = true
    const offlineFreshTab = await offlineContext.newPage()
    await offlineFreshTab.goto(origin + '/' + deepLink,
      { waitUntil: 'domcontentloaded' })
    await offlineFreshTab.locator('#web-login-username').waitFor()
    assert.equal((await refreshCookie(offlineContext)), undefined)
    summary.onlineTombstoneRemoteRevoked = true

    // Capability denial in ACTUAL Chromium is a Safari-LIKE fault injection,
    // not evidence that real Safari/WebKit has been exercised. In single-tab
    // operation we require secure fallback, not nonexistent cross-tab locks.
    for (const denial of ['getter', 'request']) {
      checkpoint = 'restricted-lock-' + denial
      const limited = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
      })
      capabilityContexts.push(limited)
      await limited.addInitScript(kind => {
        Object.defineProperty(Navigator.prototype, 'locks', {
          configurable: true,
          get() {
            if (kind === 'getter') {
              throw new DOMException('permission denied', 'SecurityError')
            }
            return {
              request() {
                throw new DOMException('permission denied', 'SecurityError')
              },
            }
          },
        })
      }, denial)
      const restrictedPage = await limited.newPage()
      restrictedPage.setDefaultTimeout(30000)
      let loginPosts = 0
      let refreshPosts = 0
      restrictedPage.on('request', req => {
        if (req.method() !== 'POST') return
        const path = new URL(req.url()).pathname
        if (path === browserLogin) loginPosts++
        if (path === browserRefresh) refreshPosts++
      })
      await restrictedPage.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
      await restrictedPage.locator('#web-login-username').waitFor()
      assert.equal(await restrictedPage.evaluate(kind => {
        try {
          if (kind === 'getter') void navigator.locks
          else navigator.locks.request('test-restriction', () => {})
        } catch (error) {
          return error?.name === 'SecurityError'
        }
        return false
      }, denial), true)
      const restrictedLogin = restrictedPage.waitForResponse(
        isResponse(browserLogin, 'POST', 200))
      await restrictedPage.locator('#web-login-username').fill(ready.username)
      await restrictedPage.locator('#web-login-password')
        .fill('PwaRealGin-TestOnly_2026!')
      await restrictedPage.getByRole('button', { name: '登录', exact: true }).click()
      await restrictedLogin
      await restrictedPage.locator('#web-login-username').waitFor({ state: 'detached' })
      requirePrivateState(await inspectPrivateStorage(restrictedPage))
      assert.equal(loginPosts, 1, 'restricted Web Locks must not replay login')
      const restrictedRefresh = restrictedPage.waitForResponse(
        isResponse(browserRefresh, 'POST', 200))
      await restrictedPage.reload({ waitUntil: 'domcontentloaded' })
      await restrictedRefresh
      await restrictedPage.locator('#web-login-username').waitFor({ state: 'detached' })
      assert.equal(refreshPosts, 1, 'denied lock must not duplicate refresh')
      requirePrivateState(await inspectPrivateStorage(restrictedPage))
      const restrictedLogout = restrictedPage.waitForResponse(
        isResponse(browserLogout, 'POST', 204))
      await restrictedPage.getByRole('button', { name: '账户菜单' }).first().click()
      await restrictedPage.getByRole('menuitem', { name: '退出登录' }).click()
      await restrictedLogout
      await restrictedPage.locator('#web-login-username').waitFor()
      assert.equal(await refreshCookie(limited), undefined)
      if (denial === 'getter') summary.restrictedLockGetterFallback = true
      else summary.restrictedLockRequestFallback = true
    }

    // Safari-like denied localStorage accessor: the current in-memory Owner
    // may log in, but no ownerless ambient Cookie is permitted to restore
    // a session in a new document. Do not assume durable logout offline when
    // local storage itself is unavailable.
    checkpoint = 'restricted-localStorage-getter'
    const storageDenied = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'zh-CN',
    })
    capabilityContexts.push(storageDenied)
    await storageDenied.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('storage denied', 'SecurityError') },
      })
    })
    const storagePage = await storageDenied.newPage()
    storagePage.setDefaultTimeout(30000)
    storagePage.on('pageerror', error => {
      if (summary.deniedStoragePageErrors.length < 8) {
        summary.deniedStoragePageErrors.push(String(error?.name || 'Error').slice(0, 48))
      }
    })
    checkpoint = 'restricted-storage-initial-navigation'
    await storagePage.goto(origin + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    checkpoint = 'restricted-storage-login-form-mount'
    await storagePage.locator('#web-login-username').waitFor()
    checkpoint = 'restricted-storage-SecurityError-active'
    assert.equal(await storagePage.evaluate(() => {
      try { void localStorage } catch (error) { return error?.name === 'SecurityError' }
      return false
    }), true)
    const deniedStorageLogin = storagePage.waitForResponse(
      isResponse(browserLogin, 'POST', 200))
    const deniedStorageRead = storagePage.waitForResponse(
      isResponse(folderPath, 'GET', 200))
    checkpoint = 'restricted-storage-submit-login-form'
    await storagePage.locator('#web-login-username').fill(ready.username)
    await storagePage.locator('#web-login-password')
      .fill('PwaRealGin-TestOnly_2026!')
    await storagePage.getByRole('button', { name: '登录', exact: true }).click()
    checkpoint = 'restricted-storage-Gin-login-200'
    await deniedStorageLogin
    checkpoint = 'restricted-storage-private-node-200'
    await deniedStorageRead
    checkpoint = 'restricted-storage-authenticated-view'
    await storagePage.locator('#web-login-username').waitFor({ state: 'detached' })
    checkpoint = 'restricted-storage-HttpOnly-cookie-issued'
    assert((await refreshCookie(storageDenied))?.httpOnly)
    summary.deniedStorageMemoryOnly = true
    checkpoint = 'restricted-storage-reload-no-ownerless-cookie'
    let ownerlessRefreshes = 0
    storagePage.on('request', req => {
      if (req.method() === 'POST' &&
        new URL(req.url()).pathname === browserRefresh) ownerlessRefreshes++
    })
    await storagePage.reload({ waitUntil: 'domcontentloaded' })
    checkpoint = 'restricted-storage-reload-login-visible'
    await storagePage.locator('#web-login-username').waitFor()
    checkpoint = 'restricted-storage-no-ownerless-refresh'
    assert.equal(ownerlessRefreshes, 0,
      'denied Storage must not send unpinned Cookie refresh')
    assert((await refreshCookie(storageDenied))?.httpOnly,
      'existing ambient Cookie must not silently authenticate without Owner')
    summary.deniedStorageNoOwnerlessRefresh = true

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
    for (const limited of capabilityContexts) await limited.close()
    await offlineContext?.close()
    await legacyContext?.close()
    await passwordContext?.close()
    await context?.close()
    await browser?.close()
  }
}
main().catch(() => { process.exitCode = 1 })
