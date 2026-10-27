#!/usr/bin/env node
'use strict'
// Actual production XDriveApi login/restore/logout methods in disposable HTTPS
// Chromium tabs. The HTTPS Server below is a protocol fixture, NOT Gin.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const ts = require(path.resolve(__dirname, '../../web/node_modules/typescript'))
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const klass = ast.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'XDriveApi')
assert(klass, 'production XDriveApi not found')
function functionSource(name) {
  const node = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert(node, 'missing original helper: ' + name)
  return node.getText(ast).replace(/^export\s+/, '')
}
function methodSource(name) {
  const node = klass.members.find(s => ts.isMethodDeclaration(s) && s.name?.getText(ast) === name)
  assert(node, 'missing original method: ' + name)
  return node.getText(ast)
}
const code = ts.transpileModule([
  'const API_BASE = "";',
  'class ApiError extends Error { constructor(status, message) { super(message); this.status=status } }',
  functionSource('xDriveBrowserCookieExclusive'),
  'class ActualBrowserAuth {',
  'constructor(session) { this.session=session; this.refreshPromise=null; this.transferSessionEpoch=0 }',
  'setSession(next) { this.session=next }',
  'async request(path, init) { const response=await fetch(path, { ...init, headers: { "Content-Type":"application/json", ...(init.headers||{}) } }); if (!response.ok) throw new ApiError(response.status,"Legacy login failed"); return response.json(); }',
  methodSource('login'), methodSource('restoreBrowserSession'), methodSource('logout'),
  '}',
  'globalThis.ActualBrowserAuth = ActualBrowserAuth;',
].join('\n'), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
new Function(code)
if (process.env.XDRIVE_COOKIE_COMPILE_ONLY === '1') {
  console.log('Production TypeScript auth method extraction compiled successfully')
  process.exit(0)
}
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
function respond(res, status, data, cookie) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(cookie ? { 'Set-Cookie': cookie } : {}) })
  res.end(status === 204 ? '' : JSON.stringify(data || {}))
}
function cookieFrom(req) {
  return String(req.headers.cookie || '').split(';').map(x => x.trim())
    .find(x => x.startsWith('__Host-xdrive_refresh='))?.slice('__Host-xdrive_refresh='.length) || ''
}
async function bodyFrom(req) {
  let result = ''
  for await (const chunk of req) { result += chunk; if (result.length > 8192) throw Error('oversized fixture request') }
  return result
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-cookie-https-'))
  let server, browser
  try {
    const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem')
    const generated = spawnSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes',
      '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',key,'-out',cert], { stdio: 'ignore' })
    assert.equal(generated.status, 0, 'ephemeral test TLS certificate required')
    const sessions = new Map()
    let origin = '', counter = 0, legacy = false, inflight = 0, maxInflight = 0
    function issued(res, owner) {
      const token = randomUUID().replace(/-/g, '')
      sessions.set(token, owner)
      respond(res, 200, { access_token: 'access-' + ++counter, token: 'access-' + counter,
        username: owner, refresh_token: '', expires_in: 900, browser_session: true },
      '__Host-xdrive_refresh=' + token + '; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600')
    }
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (req,res) => {
      try {
        const url = new URL(req.url, origin)
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><body>Cookie fixture</body></html>'); return
        }
        const p = url.pathname
        if (p.includes('/browser/')) {
          if (legacy) return respond(res, 404, { error: 'old server' })
          if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))
            return respond(res, 403, { error: 'invalid origin' })
        }
        const input = await bodyFrom(req)
        if (p === '/api/v1/auth/browser/login' || p === '/api/v1/auth/login') {
          const user = JSON.parse(input)
          if (!['owner','other'].includes(user.username) || user.password !== 'test-only-password')
            return respond(res, 401, { error: 'bad credentials' })
          if (p.endsWith('/browser/login')) return issued(res, user.username)
          return respond(res, 200, { access_token: 'legacy-access', username: user.username,
            refresh_token: 'legacy-fixture-only', expires_in: 900 })
        }
        const currentToken = cookieFrom(req), owner = sessions.get(currentToken)
        if (owner && req.headers['x-xdrive-browser-owner'] && owner !== req.headers['x-xdrive-browser-owner'])
          return respond(res, 409, { error: 'Owner mismatch' })
        if (p.endsWith('/browser/refresh')) {
          if (input) return respond(res, 400, { error: 'unexpected JSON body' })
          if (!owner) return respond(res, 401, { error: 'missing session' })
          inflight++; maxInflight = Math.max(maxInflight, inflight)
          try {
            await new Promise(resolve => setTimeout(resolve, 35))
            if (!sessions.has(currentToken)) return respond(res, 401, { error: 'replay' })
            sessions.delete(currentToken); return issued(res, owner)
          } finally { inflight-- }
        }
        if (p.endsWith('/browser/logout')) {
          sessions.delete(currentToken)
          return respond(res, 204, null,
            '__Host-xdrive_refresh=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        }
        return respond(res, 404, { error: 'missing endpoint' })
      } catch { return respond(res, 500, { error: 'fixture failed' }) }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = 'https://127.0.0.1:' + server.address().port
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({ ignoreHTTPSErrors: true }) // self-signed test cert only
    const a = await context.newPage(), b = await context.newPage()
    for (const page of [a, b]) {
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.addScriptTag({ content: code })
      assert.equal(await page.evaluate(() => window.isSecureContext), true)
    }
    assert.equal(await a.evaluate(() => typeof navigator.locks?.request), 'function')
    const login = await a.evaluate(() => new ActualBrowserAuth({}).login('owner','test-only-password',true))
    assert.equal(login.browser_session, true)
    assert.equal(login.refresh_token, '')
    const cookie = (await context.cookies(origin)).find(c => c.name === '__Host-xdrive_refresh')
    assert(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict')
    assert.equal(await a.evaluate(() => document.cookie.includes('__Host-xdrive_refresh')), false)
    const restoration = () => new ActualBrowserAuth({ browserSession: true, username: 'owner' }).restoreBrowserSession()
    const both = await Promise.all([a.evaluate(restoration), b.evaluate(restoration)])
    assert.deepEqual(both.map(x => x.username), ['owner','owner'])
    assert.equal(maxInflight, 1, 'real Web Locks must serialize two same-origin browser tabs')
    const changed = await b.evaluate(() => new ActualBrowserAuth({}).login('other','test-only-password',true))
    assert.equal(changed.username, 'other')
    const oldOwner = await a.evaluate(async () => {
      try { await new ActualBrowserAuth({browserSession:true,username:'owner'}).restoreBrowserSession(); return 200 }
      catch (err) { return err.status }
    })
    assert.equal(oldOwner, 409)
    await b.evaluate(() => new ActualBrowserAuth({browserSession:true,username:'other'}).logout())
    assert.equal((await context.cookies(origin)).some(c => c.name === '__Host-xdrive_refresh'), false)
    legacy = true
    const compatible = await a.evaluate(() => new ActualBrowserAuth({}).login('owner','test-only-password',true))
    assert.equal(compatible.refresh_token, 'legacy-fixture-only')
    assert.notEqual(compatible.browser_session, true)
    console.log(JSON.stringify({ suite: 'Chrome-HTTPS-production-TypeScript-methods',
      sameOrigin: true, webLocks: true, twoTabs: true, ownerFence: true,
      httpOnly: true, oldJSONCompatibility: true,
      ginPostgreSQL: false, tlsTrust: 'ephemeral-test-cert-only', passed: true }))
  } finally {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(String(error.message || error).slice(0,700)); process.exitCode = 1 })
