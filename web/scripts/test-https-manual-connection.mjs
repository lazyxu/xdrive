import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/manualConnection.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0)
const module = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const valid = [
  ['lan', 'https://192.168.2.4:8443', 'https://192.168.2.4:8443'],
  ['lan', 'https://10.1.2.3', 'https://10.1.2.3'],
  ['lan', 'https://172.31.2.4:443', 'https://172.31.2.4'],
  ['public', 'https://drive.example.com:8443', 'https://drive.example.com:8443'],
]
for (const [kind, input, expected] of valid) {
  const actual = module.xDriveManualEndpoint(kind, input)
  assert.deepEqual(actual, { origin: expected, insecure: false, error: '' }, input)
}
const disallowed = [
  ['lan', 'http://192.168.2.4:8443'],
  ['public', 'http://drive.example.com'],
  ['lan', 'https://8.8.8.8'],
  ['lan', 'https://127.0.0.1'],
  ['lan', 'https://192.168.02.4'],
  ['lan', 'https://192.168.2.4/path'],
  ['public', 'https://192.168.2.4'],
  ['public', 'https://alice:pass@drive.example.com'],
]
for (const [kind, input] of disallowed) {
  assert.ok(module.xDriveManualEndpoint(kind, input).error, input)
}
console.log('Web manual entry: HTTPS-only private IPv4/domain, origin isolation and malformed input passed')
