'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const model = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const screen = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift')
const profiles = read('ios/XDriveIOS/NativePasswordProfiles.swift')
const draft = read('ios/XDriveIOS/NativeLoginDraftStore.swift')
const session = read('ios/XDriveIOS/NativeOwnerSessionStore.swift')

const between = (start, end) => {
  assert.ok(model.includes(start), `missing model boundary: ${start}`)
  assert.ok(model.includes(end), `missing model boundary: ${end}`)
  return model.split(start)[1].split(end)[0]
}

test('cold signed-out startup prefills a previously opted-in Keychain password for the exact saved identity', () => {
  const init = between('    init() {', '    var currentSavedProfile:')
  assert.match(init, /serverText = draft\.server[\s\S]*lanIPText = draft\.lanIP[\s\S]*username = draft\.username/)
  assert.match(init, /savedProfiles = XDriveIOSNativePasswordProfiles\.list\(\)[\s\S]*prefillSavedPasswordForCurrentProfile\(\)/)

  const prefill = between('    private func prefillSavedPasswordForCurrentProfile() {',
                          '    /// Account and route changes')
  assert.match(prefill, /password = ""\s+rememberPassword = false/)
  assert.match(prefill, /guard active == nil, owner == nil, let item = currentSavedProfile else \{ return \}/)
  assert.match(prefill, /try XDriveIOSNativePasswordProfiles\.password\(for: item\)/)
  assert.match(prefill, /password = saved\s+rememberPassword = true/)
  assert.doesNotMatch(prefill, /AuthService|signIn\(\)|refresh\(|UserDefaults|print\(/)
})

test('Keychain selection is exactly scoped to canonical HTTPS Server, LAN route, and username', () => {
  const selected = between('    var currentSavedProfile:', '    var savedProfilePasswordAvailable:')
  assert.match(selected, /server: serverText, lanIP: lanIPText/)
  assert.match(selected, /username: username\.trimmingCharacters/)
  assert.match(profiles, /var id: String \{ server \+ "\\u\{001F\}" \+ lanIP \+ "\\u\{001F\}" \+ username \}/)
  assert.match(profiles, /kSecAttrAccount as String: item\.id/)
  assert.match(profiles, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/)
  assert.doesNotMatch(draft, /let (?:password|accessToken|refreshToken):/)
  assert.match(session, /static let account = "active-verified-owner"/)
})

test('choosing another saved profile replaces the password rather than leaking previous identity', () => {
  const choose = between('    func chooseSavedProfile(', '    /// User-triggered only:')
  assert.match(choose, /guard !busy, active == nil/)
  assert.match(choose, /serverText = item\.server\s+lanIPText = item\.lanIP\s+username = item\.username/)
  assert.ok(choose.indexOf('displayedIdentity =') < choose.indexOf('prefillSavedPasswordForCurrentProfile()'))
  const edited = between('    func discardPasswordAfterIdentityEdit()', '    func chooseSavedProfile(')
  assert.match(edited, /password = ""/)
  assert.match(edited, /rememberPassword = false/)
  assert.doesNotMatch(edited, /prefillSavedPasswordForCurrentProfile/)
  assert.match(screen, /SecureField\("密码", text: \$model\.password\)/)
})

test('explicit logout fills from Keychain only after successful local refresh-token deletion', () => {
  const signOut = model.split('    func signOut() async -> Bool {')[1]
  assert.ok(signOut.indexOf('try XDriveIOSNativeOwnerSessionStore.clear()') <
            signOut.indexOf('active = nil'))
  assert.ok(signOut.indexOf('active = nil') <
            signOut.indexOf('prefillSavedPasswordForCurrentProfile()'))
  assert.match(signOut, /active = nil\s+owner = nil\s+prefillSavedPasswordForCurrentProfile\(\)/)
  const restore = between('    func restore() async {', '    /// User-initiated only: never auto-loop')
  assert.match(restore, /owner = verified\s+password = ""/)
  const signIn = between('    func signIn() async {', '    /// A failed local Keychain deletion')
  assert.match(signIn, /owner = verified\s+password = ""/)
  assert.match(signIn, /if attemptedRememberPassword \{\s+try XDriveIOSNativePasswordProfiles\.savePassword/)
  assert.match(signIn, /else \{\s+try XDriveIOSNativePasswordProfiles\.removePassword/)
})

test('forget deletes the profile secret and clears the visible password', () => {
  const forget = between('    func clearSavedLogin() {', '    func pairLANHTTPS() async {')
  assert.match(forget, /try XDriveIOSNativePasswordProfiles\.forget\(selected\)/)
  assert.match(forget, /password = ""\s+rememberPassword = false/)
  assert.doesNotMatch(forget, /prefillSavedPasswordForCurrentProfile/)
})

test('Keychain autofill errors remain visible during cold start and account selection', () => {
  const prefill = between('    private func prefillSavedPasswordForCurrentProfile() {',
                          '    /// Account and route changes')
  assert.match(prefill, /catch \\{[\\s\\S]*?errorMessage = "无法从系统 Keychain 读取保存的密码/)

  const choose = between('    func chooseSavedProfile(', '    /// User-triggered only:')
  const reset = choose.indexOf('errorMessage = nil')
  const prefillCall = choose.indexOf('prefillSavedPasswordForCurrentProfile()')
  assert.ok(reset >= 0 && reset < prefillCall, 'clear old error before Keychain lookup')
  assert.equal((choose.match(/errorMessage = nil/g) || []).length, 1,
    'a new Keychain read error must not be cleared after lookup')

  const restore = between('    func restore() async {',
                          '    /// User-initiated only: never auto-loop')
  assert.ok(restore.indexOf('guard let saved = try XDriveIOSNativeOwnerSessionStore.load()') <
    restore.indexOf('errorMessage = nil'),
    'no refresh session must not erase a prefill Keychain error')
  assert.match(restore, /guard let saved = try XDriveIOSNativeOwnerSessionStore\\.load\\(\\)[\\s\\S]*?else \\{[\\s\\S]*?return\\s*\\}[\\s\\S]*?errorMessage = nil/)

  const retry = between('    func retryStoredSession() async {',
                        '    /// Forget only this Server+username.')
  assert.match(retry, /errorMessage = nil\\s+restoreAttempted = false\\s+await restore\\(\\)/)
})
