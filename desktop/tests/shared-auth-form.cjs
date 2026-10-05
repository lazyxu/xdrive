const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedAuth = read('ui', 'shared', 'src', 'mui', 'AuthForm.tsx')
const sharedIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const passwordForm = read('ui', 'shared', 'src', 'mui', 'PasswordChangeForm.tsx')
const webApp = read('web', 'src', 'App.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopStyles = read('desktop', 'src', 'renderer', 'styles.css')

test('Web and Desktop share canonical MUI auth form primitives', () => {
  for (const token of [
    'export function XDriveAuthField',
    'export function XDriveAuthFieldStatus',
    'export function XDriveAuthPasswordField',
    'export function XDriveAuthSubmitRow',
    "borderColor: 'primary.main'",
    'VisibilityOffRoundedIcon',
    'VisibilityRoundedIcon',
    'if (!value) setVisible(false)',
  ]) {
    assert.ok(sharedAuth.includes(token), `shared auth form missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './AuthForm'"), 'shared MUI barrel must export auth form primitives')

  for (const source of [webApp, desktopApp]) {
    assert.ok(source.includes('<XDriveAuthField'), 'platform login must use shared auth field chrome')
    assert.ok(source.includes('<XDriveAuthPasswordField'), 'platform login must use shared password chrome')
    assert.ok(source.includes('<XDriveAuthSubmitRow'), 'platform login must use shared submit chrome')
  }
  assert.ok(desktopApp.includes('<XDriveAuthFieldStatus'), 'Desktop server probe should use shared auth status chrome')
})

test('password-change surfaces reuse shared password fields', () => {
  assert.ok(passwordForm.includes("import { XDriveAuthPasswordField } from './AuthForm'"))
  assert.equal((passwordForm.match(/<XDriveAuthPasswordField/g) || []).length, 3)
  assert.ok(passwordForm.includes('sx?: SxProps<Theme>'), 'shared password form should support MUI spacing without local CSS')
})

test('Desktop auth presentation no longer depends on local auth CSS or stale class hooks', () => {
  assert.equal(/\.auth-[A-Za-z0-9_-]+/.test(desktopStyles), false, 'Desktop must not keep auth-specific CSS selectors')
  assert.equal(/className="auth-[A-Za-z0-9_-]+/.test(desktopApp), false, 'Desktop must not keep stale auth class hooks')
  assert.equal(passwordForm.includes('buttonClassName'), false, 'shared password form must not expose a stale button class hook')
  assert.equal(passwordForm.includes('className={className}'), false, 'shared password form must not expose a stale form class hook')
  assert.equal(desktopApp.includes("import VisibilityOffRoundedIcon"), false, 'password visibility presentation belongs in shared MUI')
  assert.equal(desktopApp.includes("import VisibilityRoundedIcon"), false, 'password visibility presentation belongs in shared MUI')
  assert.equal(desktopApp.includes('<InputAdornment'), false, 'password adornment presentation belongs in shared MUI')
  assert.equal(desktopApp.includes('<Chip className="auth-saved-chip"'), false, 'saved credential badge belongs in shared MUI')
  assert.ok(desktopApp.includes("sx={{ mt: 2.75 }}"), 'forced password form should keep spacing through MUI sx')
})
