'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filePath = path.join(__dirname, '..', 'src', 'renderer', 'App.tsx')
const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function arrowVariable(name) {
  let result
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === name) {
      result = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `Missing real renderer binding: ${name}`)
  return result.getText(source)
}

function inputArrow(attribute, contains) {
  const hits = []
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.text === attribute &&
        node.initializer && ts.isJsxExpression(node.initializer) &&
        node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
      const code = node.initializer.expression.getText(source)
      if (code.includes(contains)) hits.push(code)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(hits.length, 1, `Ambiguous input handler for ${contains}`)
  return hits[0]
}

function compile(sourceCode, bindings) {
  const code = ts.transpileModule(`const callback = ${sourceCode};`, {
    fileName: filePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const names = Object.keys(bindings)
  return new Function(...names, code + '\nreturn callback')(
    ...names.map(name => bindings[name]))
}

function loginState() {
  const state = {
    server: 'https://one.example', username: 'alice', password: 'old-secret',
    route: { mode: 'auto', lan_ip: '192.168.1.20', public_ip: '' },
    remember: true, auto: true, error: 'previous failure',
    edited: { current: false }, profileSelected: null,
  }
  const bindings = {
    server: state.server,
    username: state.username,
    connectionRoute: state.route,
    loginHistory: { profiles: [{
      server: state.server, username: state.username,
      remember_password: true, auto_login: true,
    }] },
    loginDraftUserEditedRef: state.edited,
    setServer: value => { state.server = value },
    setUsername: value => { state.username = value },
    setPassword: value => { state.password = value },
    setRememberPassword: value => { state.remember = value },
    setAutoLogin: value => { state.auto = value },
    setError: value => { state.error = value },
    setConnectionRoute: value => { state.route = value },
    applyLoginProfile: value => { state.profileSelected = value },
  }
  return { state, bindings }
}

test('Desktop typing an unknown Server clears old Owner password and auto-login toggles', () => {
  const { state, bindings } = loginState()
  const handler = compile(inputArrow('onInputChange', 'setServer(value)'), bindings)
  handler({}, 'https://new.example', 'input')
  assert.equal(state.server, 'https://new.example')
  assert.equal(state.password, '')
  assert.equal(state.remember, false)
  assert.equal(state.auto, false)
  assert.equal(state.edited.current, true)
})

test('Desktop typing a new username cannot carry the previous account password', () => {
  const { state, bindings } = loginState()
  const handler = compile(inputArrow('onInputChange', 'setUsername(value)'), bindings)
  handler({}, 'bob', 'input')
  assert.equal(state.username, 'bob')
  assert.equal(state.password, '')
  assert.equal(state.auto, false)
})

test('Desktop manually changing the selected LAN IP must clear typed credentials', () => {
  const { state, bindings } = loginState()
  const handler = compile(inputArrow('onChange', 'const nextLAN = event.target.value.trim()'), bindings)
  handler({ target: { value: '192.168.1.33' } })
  assert.equal(state.route.lan_ip, '192.168.1.33')
  assert.equal(state.password, '')
  assert.equal(state.remember, false)
  assert.equal(state.auto, false)
})

test('Desktop FreeSolo change commits cannot reintroduce a previous password', () => {
  for (const [name, value, field] of [
    ['selectLoginServer', 'https://unknown.example', 'server'],
    ['selectLoginUsername', 'other-user', 'username'],
  ]) {
    const { state, bindings } = loginState()
    const handler = compile(arrowVariable(name), bindings)
    handler(value)
    assert.equal(state[field], value)
    assert.equal(state.password, '')
    assert.equal(state.remember, false)
    assert.equal(state.auto, false)
  }
})

test('Desktop saved password use requires the same remembered LAN route', () => {
  const expression = arrowVariable('savedPasswordAvailable')
  const old = { connection_route: { lan_ip: '192.168.1.20' } }
  const allowed = compile(expression, {
    password: '', hasStoredPassword: true,
    matchingLoginProfile: old,
    connectionRoute: { lan_ip: '192.168.1.20' },
  })
  assert.equal(allowed, true)
  const blocked = compile(expression, {
    password: '', hasStoredPassword: true,
    matchingLoginProfile: old,
    connectionRoute: { lan_ip: '192.168.1.33' },
  })
  assert.equal(blocked, false)
  assert.equal(compile(expression, {
    password: 'typed', hasStoredPassword: true,
    matchingLoginProfile: old,
    connectionRoute: { lan_ip: '192.168.1.20' },
  }), false)
})
