'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const root = join(__dirname, '../..')
const read = path => readFileSync(join(root, path), 'utf8')
const ui = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift')
const model = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const route = read('ios/XDriveIOS/NativeLANLoginRoute.swift')
const smoke = read('ios/scripts/prepare-navigation-runtime-smoke.py')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const uiTest = read('ios/UITests/XDriveIOSCompactLoginUITests.swift')
const form = ui.slice(ui.indexOf('    private var loginForm: some View {'),
  ui.indexOf('    // This is an emergency OFF operation'))
const advanced = form.slice(form.indexOf('DisclosureGroup(isExpanded: $showAdvancedConnection)'),
  form.indexOf('DisclosureGroup(isExpanded: $showLoginPreferences)'))
const preferences = form.slice(form.indexOf('DisclosureGroup(isExpanded: $showLoginPreferences)'))
const errors = ui.slice(ui.indexOf('if let warning = model.errorMessage {'),
  ui.indexOf('                            helpAndEmergency'))
const help = ui.slice(ui.indexOf('    private var helpAndEmergency: some View {'),
  ui.indexOf('    private var aboutSection: some View {'))
const about = ui.slice(ui.indexOf('    private var aboutSection: some View {'),
  ui.indexOf('    private func compactFeedback('))

test('01 only one xDrive header remains without duplicate Brand content', () => {
  assert.equal((ui.match(/\.navigationTitle\("xDrive"\)/g) || []).length, 1)
  assert.doesNotMatch(ui, /Image\("Brand"\)/)
  assert.doesNotMatch(ui, /Text\("xDrive"\)/)
})
test('02 removes the iOS native-client subtitle', () => {
  assert.doesNotMatch(ui, /Text\("iOS 原生客户端"\)/)
})
test('03 removes the extra personal-cloud tagline', () => {
  assert.doesNotMatch(ui, /Text\("连接到你的个人云端"\)/)
})
test('04 private-IP editor is gated behind a default-closed Advanced disclosure', () => {
  assert.match(ui, /@State private var showAdvancedConnection = false/)
  assert.match(advanced, /DisclosureGroup\(isExpanded: \$showAdvancedConnection\)/)
  assert.match(advanced, /TextField\("192\.168\.2\.4", text: \$model\.lanIPText\)/)
  assert.match(advanced, /native-ios-login-lan-ip/)
  assert.match(advanced, /Label\("高级连接设置"/)
  assert.match(uiTest, /testAdvancedConnectionAndLANHelpRemainAvailable/)
})
test('05 full route policy is help-only, not permanently on login screen', () => {
  assert.match(advanced, /DisclosureGroup\(isExpanded: \$showLANHelp\)/)
  assert.match(advanced, /登录前检测一次内网 HTTPS/)
  assert.match(ui, /@State private var showLANHelp = false/)
})
test('06 Caddy root renewal help is also on-demand', () => {
  assert.match(advanced, /首次使用或 Caddy 根证书更换后/)
  assert.match(advanced, /native-ios-lan-certificate-help/)
})
test('07 TLS pairing remains executable inside Advanced and opens from relevant errors', () => {
  assert.match(advanced, /Button\("配对或更新内网 HTTPS 证书"\)/)
  assert.match(advanced, /Task \{ await model\.pairLANHTTPS\(\) \}/)
  assert.match(errors, /showAdvancedConnection = true/)
  assert.match(errors, /native-ios-lan-open-advanced-on-error/)
  assert.match(route, /mode: \.verifyingPairing\(target, der\)/)
})
test('08 Keychain password-save switch is in Preferences with explicit-user revoke', () => {
  assert.match(ui, /@State private var showLoginPreferences = false/)
  assert.match(preferences, /Toggle\("安全保存当前账号密码", isOn: Binding\(/)
  assert.match(preferences, /set: \{ model\.setRememberPasswordFromUser\(\$0\) \}/)
  assert.match(model, /try XDriveIOSNativePasswordProfiles\.removePassword\(for: item\)/)
})
test('09 keep-signed-in defaults on and can still be disabled in Preferences', () => {
  assert.match(model, /@Published var keepSignedIn = true/)
  assert.match(preferences, /Toggle\("保持登录", isOn: \$model\.keepSignedIn\)/)
  assert.match(preferences, /native-ios-keep-signed-in/)
  assert.match(model, /if keepSignedIn \{[\s\S]*?XDriveIOSNativeOwnerSessionStore\.save/)
})
test('10 one primary Login button reuses exactly scoped saved-password sign-in', () => {
  assert.doesNotMatch(ui, /Button\("使用已安全保存的密码重新登录"\)/)
  assert.match(form, /if model\.password\.isEmpty && model\.savedProfilePasswordAvailable \{[\s\S]*?await model\.signInWithSavedPassword\(\)/)
  assert.match(form, /else \{\s*await model\.signIn\(\)/)
  assert.match(model, /guard !busy, active == nil, let item = currentSavedProfile else/)
})
test('11 destructive Forget exists only under saved-account Menu with original confirmation', () => {
  const menu = form.slice(form.indexOf('Menu {'), form.indexOf('Text("服务器 HTTPS 地址")'))
  assert.match(menu, /ForEach\(model\.savedProfiles\)/)
  assert.match(menu, /model\.savedProfiles\.contains\(selected\)/)
  assert.match(menu, /Button\("忘记当前服务器和账号资料", role: \.destructive\)/)
  assert.match(form, /isPresented: \$clearSavedLoginConfirm/)
  assert.match(form, /backup\.cancel\(\)\s+model\.clearSavedLogin\(\)/)
})
test('12 Web/PWA cookie implementation note is gone from default login', () => {
  assert.doesNotMatch(ui, /仅使用原生 HTTPS 会话；不会读取或复制 PWA Cookie/)
  assert.doesNotMatch(ui, /WKWebView\(|URLSession\.shared|trustAllHosts/)
})
test('13 build SHA is under About and exact failure details, and remains copyable', () => {
  assert.match(ui, /@State private var showAbout = false/)
  assert.match(about, /Text\(XDriveIOSNativeBuildIdentity\.label\)/)
  assert.match(about, /Button\("复制版本信息"\)/)
  assert.match(about, /UIPasteboard\.general\.string = XDriveIOSNativeBuildIdentity\.label/)
  assert.match(errors, /Text\(XDriveIOSNativeBuildIdentity\.label\)/)
  assert.match(errors, /native-ios-login-copy-diagnostics/)
})
test('14 stop-only backup safety stays accessible while signed out and offline', () => {
  assert.match(ui, /@State private var showHelpAndEmergency = false/)
  assert.match(help, /Button\("紧急停止本机相册自动备份", role: \.destructive\)/)
  assert.match(help, /Task \{ await emergencyStopWithoutAccount\(\) \}/)
  assert.match(ui, /disableAllOnThisDevice\(\)/)
  assert.match(ui, /XDriveIOSBackgroundPhotoTask\.revokePendingRequests\(\)/)
  assert.match(ui, /\.emergencyStopLocally\(\)/)
  assert.match(uiTest, /testHelpStillExposesOfflineEmergencyStop/)
})
test('15 normal feedback is compact, raw bounded diagnostics available by explicit expansion', () => {
  assert.match(errors, /compactFeedback\(warning, isError: true\)/)
  assert.match(errors, /if showErrorDetails \{[\s\S]*?Text\(warning\)/)
  assert.match(errors, /String\(\(warning \+ "\\n" \+/)
  assert.match(errors, /\.prefix\(2048\)/)
  assert.match(ui, /@State private var showErrorDetails = false/)
  assert.match(ui, /@State private var showNoticeDetails = false/)
})
test('16 refresh retry is inside the error state, never permanently on default form', () => {
  assert.match(errors, /if model\.canRetryStoredSessionForCurrentDraft \{/)
  assert.match(errors, /Task \{ await model\.retryStoredSession\(\) \}/)
  assert.match(errors, /native-ios-saved-session-retry/)
  assert.ok(!form.includes('native-ios-saved-session-retry'))
})
test('real simulator validates compact/Advanced/preferences/help/about, no fake Owner grant', () => {
  assert.match(smoke, /-xdrive-ui-login-compact-smoke/)
  assert.match(workflow, /XDriveIOSCompactLoginUITests/)
  for (const token of ['testDefaultFormContainsOnlyCoreFields',
    'testAdvancedConnectionAndLANHelpRemainAvailable',
    'testPreferencesAndAboutRemainReachable',
    'testHelpStillExposesOfflineEmergencyStop']) {
    assert.match(uiTest, new RegExp(token))
  }
  assert.doesNotMatch(uiTest, /xdrive-ui-navigation-synthetic-owner|signIn\(\)|pairLANHTTPS\(\)/)
})
