import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/mobileDefaultLandingRoute.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0)
const { xDriveWebDefaultLandingRoute: landing } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const gallery = { app: 'gallery', params: {} }
const all = { app: 'overview', params: {} }
assert.deepEqual(landing('', true), gallery, 'Mobile Web/PWA bare root must enter Gallery first')
assert.deepEqual(landing('', false), all, 'Wide Web/Desktop default remains unchanged')
for (const hash of [
  '#/app/overview', '#/app/files', '#/app/gallery', '#/s/opaque',
  '#/app/unknown', '#/', '#old-client',
]) {
  assert.deepEqual(landing(hash, true), all,
    'explicit or malformed hash cannot be reinterpreted as a Gallery request: ' + hash)
}
const runtime = readFileSync(resolve(here, '../src/webAppRuntime.ts'), 'utf8')
assert.match(runtime, /xDriveParseWebAppHash\(hash\) \?\?\s*xDriveWebDefaultLandingRoute\(hash, xDriveIsCompactWebViewport\(\)\)/,
  'existing parsed route/deep link must win before the mobile default')
assert.match(runtime, /window\.matchMedia\('\(max-width:899\.95px\)'\)/,
  'match the real compact workspace breakpoint')
assert.match(runtime, /catch \{[\s\S]*?return false\s*\}/,
  'restricted Safari media-query APIs must fail safely')
assert.match(runtime, /if \(!xDriveParseWebAppHash\(window\.location\.hash\)\) \{\s*const landing = currentRoute\(\)/)
assert.match(runtime, /window\.history\.replaceState\([^\n]*xDriveWebAppHash\(landing\)\)/,
  'initial mobile hash and rendered route must be identical, without a pushed history entry')
assert.match(runtime, /window\.addEventListener\('hashchange', sync\)/,
  'real browser navigation and its existing guarded history remain intact')
console.log('Web Mobile/PWA Gallery-first root: deep links, history, breakpoint and safe fallback passed')
