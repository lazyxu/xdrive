const fs = require('node:fs');
const cp = require('node:child_process');
const ts = require('/workspace/scratch/e20e4f73f413/xdrive/desktop/node_modules/typescript');
const repo = '/workspace/scratch/4fa175e5d1c9/xdrive-transfer';
const before = cp.execFileSync('git', ['show', '8cfdcd71:web/src/downloadSink.ts'], { cwd: repo, encoding: 'utf8' });
const after = fs.readFileSync(repo + '/web/src/downloadSink.ts', 'utf8');
function load(source) {
  const module = { exports: {} };
  new Function('exports', 'module', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module.exports, module, require);
  return module.exports;
}
(async () => {
  for (const [name, source, native] of [['before', before, false], ['candidate', after, true]]) {
    const progress = [];
    const error = new Error('sink failed before writing bytes');
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
    const writable = native ? new WritableStream({ write() { throw error; } }) : { async write() { throw error; }, async close() {}, async abort() {} };
    const sink = { kind: 'file-system', settled: false, writable };
    try { await load(source).xDriveWriteWebDownloadToSink(body, sink, async () => new Blob(), n => progress.push(n)); }
    catch (observed) { console.log(name, JSON.stringify({ progress, error: observed.message, settled: sink.settled })); }
  }
})();
