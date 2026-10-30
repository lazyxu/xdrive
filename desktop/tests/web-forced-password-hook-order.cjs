'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/App.tsx'), 'utf8')

test('required-password profile transition preserves FileManager React hook order', () => {
  // AST-enforced: neither a conditional nor a nested block may return from
  // the FileManager render frame before its shared Host Hook has run.
  // Returns inside event handlers and the inert password-form builder are
  // nested functions; they must not be confused with a component return.
  const syntaxTree = ts.createSourceFile('App.tsx', source,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(syntaxTree.parseDiagnostics.length, 0, 'production App TSX must parse')
  const fileManager = syntaxTree.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'FileManager')
  assert.ok(fileManager?.body, 'real FileManager function body is required')
  const bodyStatements = fileManager.body.statements
  const hostDeclarationIndex = bodyStatements.findIndex(statement =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
      declaration => declaration.name.getText(syntaxTree) === 'browserWorkspaceHost'))
  assert.ok(hostDeclarationIndex >= 0, 'shared Browser Host Hook declaration missing')
  const canReturnFromRender = node => {
    if (ts.isReturnStatement(node)) return true
    if (ts.isFunctionLike(node)) return false
    return Boolean(ts.forEachChild(node,
      child => canReturnFromRender(child) || undefined))
  }
  assert.deepEqual(bodyStatements.slice(0, hostDeclarationIndex)
    .filter(canReturnFromRender).map(statement => statement.getText(syntaxTree).slice(0, 120)),
    [], 'FileManager must invoke the shared Host Hook before ANY render-path return')

  const component = source.slice(source.indexOf('function FileManager({'))
  assert.ok(component.startsWith('function FileManager({'), 'real routed FileManager must exist')
  const form = component.indexOf('const forcedPasswordContent = (() => {')
  const formGate = component.indexOf('if (!(profile?.must_change_password || loginPasswordChangeRequired)) return null', form)
  const formEnd = component.indexOf('\n  })()', formGate)
  const hostHook = component.indexOf('const browserWorkspaceHost = useMemo(', formEnd)
  const finalGate = component.indexOf('if (forcedPasswordContent) return forcedPasswordContent', hostHook)
  assert.ok(form >= 0 && formGate > form && formEnd > formGate,
    'forced-password UI must be captured as content, not returned from FileManager before hooks')
  assert.ok(hostHook > formEnd && finalGate > hostHook,
    'shared Browser Host useMemo must execute on both normal and forced-password renders')
  assert.ok(component.indexOf('const workspaceActions =', finalGate) > finalGate,
    'only actual content rendering should be bypassed, not Hook invocation')
  assert.ok(!component.slice(form, hostHook).includes('  if (profile?.must_change_password || loginPasswordChangeRequired) {'),
    'old conditional top-level return would violate React hook order')
  for (const token of [
    'await api.changePassword(passwordValues.current, passwordValues.next)',
    'setProfile({ ...currentProfile, must_change_password: false })',
    'onPasswordChanged()',
    '<XDrivePasswordChangeForm',
  ]) assert.ok(component.includes(token), 'existing Server-verified password flow missing: ' + token)
})
