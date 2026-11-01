const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const shared = read('ui/shared/src/login-draft.ts')
const desktop = read('desktop/src/renderer/App.tsx')
const desktopDraft = read('desktop/src/renderer/loginDraft.ts')
const browser = read('web/src/App.tsx')
const dsm = read('web/src/synology.tsx')
const dsmDraft = read('web/src/synologyLoginDraft.ts')

test('shared non-secret draft schema is bounded and excludes credentials', () => {
  assert.match(shared, /export function xDriveNormalizeLoginDraft/)
  for (const key of ['server', 'lanIp', 'username']) assert.match(shared, new RegExp(key + ': string'))
  assert.doesNotMatch(shared, /(?:refreshToken|accessToken|password): string/)
  assert.match(shared, /draft\.version !== 1/)
})
test('Desktop first failed attempt survives startup history and restores LAN metadata', () => {
  assert.match(desktop, /useMemo\(readDesktopLoginDraft, \[\]\)/)
  assert.match(desktop, /saveDesktopLoginDraft\(\{ server, lanIp: connectionRoute\.lan_ip, username \}\)/)
  assert.match(desktop, /if \(!initialLoginDraft\.server\)/)
  assert.match(desktop, /loginDraftUserEditedRef\.current = true/)
  assert.match(desktop, /if \(latest && !loginDraftUserEditedRef\.current\)/)
  assert.match(desktopDraft, /window\.localStorage\.setItem/)
  assert.doesNotMatch(desktopDraft, /password:|refreshToken:|accessToken:/)
})
test('Web/PWA persist only an editable username, independent of cookie', () => {
  assert.ok(browser.includes('LOGIN_DRAFT_USERNAME_KEY'))
  // Manual edits and saved-profile Autocomplete selections now share one
  // callback. Verify the *actual* callback preserves the original draft
  // persistence behavior and clears only the in-memory password on switches.
  const edit = browser.split('const editLoginUsername = (next: string) => {')[1]
    ?.split('const forgetLoginUsername = () => {')[0]
  assert.ok(edit, 'login-username edit callback must exist')
  assert.match(edit, /if \(next !== loginUsername\)/)
  assert.match(edit, /setLoginUsername\(next\)/)
  assert.match(edit, /xDriveBrowserStorageWrite\(LOGIN_DRAFT_USERNAME_KEY, next\)/)
  assert.match(edit, /setPassword\(''\)/)
  assert.match(browser, /if \(reason !== 'reset'\) editLoginUsername\(value\)/)
  assert.ok(browser.includes('const COOKIE_MODE_KEY'))
})
test('DSM reloads on ambiguous Agent outcome and restores only public login hints', () => {
  assert.match(dsm, /import \{ readDSMLoginDraft, saveDSMLoginDraft \}/)
  assert.match(dsm, /saveDSMLoginDraft\(server, username\)/)
  assert.match(dsmDraft, /function readDSMLoginDraft\(\)/)
  assert.match(dsmDraft, /xDriveBrowserStorageWrite\(DSM_LOGIN_DRAFT_KEY/)
  assert.doesNotMatch(dsm, /window\.localStorage/)
  assert.match(dsm, /if \(info\.configured\)/)
  // Agent's authenticated pre-commit 401 proof allows a safe same-Owner retry.
  // Retaining the password on the *current page* is intentional, never durable.
  const loginStart = dsm.indexOf("loginPhaseRef.current = 'logging'")
  const post = dsm.indexOf('void client.loginServer(requestedServer, requestedUsername, requestedPassword, controller.signal).then(', loginStart)
  assert.ok(loginStart >= 0 && post > loginStart, 'must enter and submit an Owner-fenced login')
  assert.doesNotMatch(dsm.slice(loginStart, post), /setPassword\(''\)/,
    'do not discard the password before a proven pre-commit rejection can return')
  const postResult = dsm.slice(post, dsm.indexOf('\n      },\n      () => {', post))
  assert.match(postResult, /failure instanceof XDriveDSMLoginNoCommitError/)
  assert.match(postResult, /current.owner_scope !== info.owner_scope/)
  assert.match(postResult, /setPassword\(''\)[\s\S]{0,100}window.location.reload\(\)/)
  assert.ok((postResult.match(/window.location.reload\(\)/g) || []).length >= 3,
    'success, ambiguous failure and Owner mismatch must each retire the workspace')
  assert.ok((dsm.match(/window\.location\.reload\(\)/g) || []).length >= 2)
  assert.doesNotMatch(dsmDraft, /(?:password|refreshToken|accessToken): string/)
  assert.doesNotMatch(dsmDraft, /window\.localStorage/)
})
