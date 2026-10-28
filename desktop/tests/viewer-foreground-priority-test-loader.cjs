'use strict'
// Execute the exact real pure production coordinator in source-extraction
// fixtures. Do not fake priority decisions or weaken preemption assertions.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const filename = path.resolve(__dirname, '../../ui/shared/src/mui/ViewerForegroundPriority.ts')
const code = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const real = { exports: {} }
new Function('module','exports',code)(real,real.exports)
module.exports = real.exports
