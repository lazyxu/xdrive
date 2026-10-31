'use strict'
// Mounted React regression for the actual DSM shared Source-create and
// native draft-bind components, without a physical Synology appliance.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const root = path.resolve(__dirname, '../..')
const SCOPE = 'a'.repeat(64)
const OTHER_SCOPE = 'b'.repeat(64)
const SELECTION = 'c'.repeat(64)
const createdAt = '2026-10-31T00:00:00Z'
const rows = [57, 58].map(source_id => ({
  source_id, revision: 1, name: 'NAS ' + source_id, created_at: createdAt,
}))

function stub(name) {
  return function Component({ children, ...props }) {
    return React.createElement(name, props, children)
  }
}
const mui = Object.fromEntries(
  ['Box', 'Button', 'Checkbox', 'FormControlLabel', 'Stack', 'Typography', 'TextField']
    .map(name => [name, stub(name)]),
)
const shareInventory = ({ onVerifiedShare }) =>
  React.createElement('share-inventory', { onVerifiedShare })
const cloudTarget = ({ onSelectTarget }) =>
  React.createElement('cloud-target', { onSelectTarget })
const draftPlaceholder = () => React.createElement('draft-placeholder')

function load(name, extra = {}) {
  const filename = path.join(root, 'ui/shared/src/mui', name + '.tsx')
  const transpiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (transpiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const mod = { exports: {} }
  const imports = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
    './SynologyNASShareInventory': { XDriveSynologyNASShareInventory: shareInventory },
    './SynologyBackupTargetBrowser': { XDriveSynologyBackupTargetBrowser: cloudTarget },
    './SynologyNativeDraftReview': { XDriveSynologyNativeDraftReview: draftPlaceholder },
    ...extra,
  }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    mod, mod.exports, id => {
      if (!(id in imports)) throw Error('unexpected import: ' + id)
      return imports[id]
    },
  )
  return mod.exports
}
const Setup = load('SynologyBackupSourceSetup').XDriveSynologyBackupSourceSetup
const Drafts = load('SynologyNativeDraftReview').XDriveSynologyNativeDraftReview
const SetupWithDrafts = load('SynologyBackupSourceSetup', {
  './SynologyNativeDraftReview': { XDriveSynologyNativeDraftReview: Drafts },
}).XDriveSynologyBackupSourceSetup
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const button = (tree, label) => {
  const match = tree.root.findAllByType('Button').find(x => {
    const content = x.props.children
    return typeof content === 'string' && content.includes(label)
  })
  assert.ok(match, 'missing button: ' + label)
  return match
}
const checkbox = (tree, prefix) => {
  const label = tree.root.findAllByType('FormControlLabel')
    .find(x => typeof x.props.label === 'string' && x.props.label.startsWith(prefix))
  assert.ok(label, 'missing consent: ' + prefix)
  return label.props.control
}
async function selectNewSource(tree, name) {
  await act(async () => {
    tree.root.findByType('share-inventory').props.onVerifiedShare({
      label: '/volume1/Photos', selection_id: SELECTION,
    })
    button(tree, '选择云端备份目标').props.onClick()
  })
  await act(async () => {
    tree.root.findByType('cloud-target').props.onSelectTarget({ id: 17, name: 'Backup Target' })
    tree.root.findByType('TextField').props.onChange({ target: { value: name } })
    checkbox(tree, '我确认在当前 NAS').props.onChange({ target: { checked: true } })
  })
}
async function mountSetup(client, onCreated) {
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Setup, { client, onCreated }))
    await Promise.resolve()
  })
  return tree
}
test('DSM Source create is synchronously one-shot; only confirmed bind unlocks a fresh second Source', async () => {
  const pending = []
  const calls = []
  let created = 0
  const client = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    createNASBackupSource: (...args) => {
      calls.push(args)
      const item = deferred()
      pending.push(item)
      return item.promise
    },
  }
  const tree = await mountSetup(client, () => { created++ })
  await selectNewSource(tree, 'NAS Photos')
  await act(async () => {
    const submit = button(tree, '确认创建并绑定本地目录')
    // Simulate two clicks before React can render the disabled state.
    submit.props.onClick()
    submit.props.onClick()
  })
  assert.equal(calls.length, 1, 'a double click must not create duplicate Sources')
  assert.deepEqual(calls[0].slice(0, 4), [SELECTION, SCOPE, 17, 'NAS Photos'])
  await act(async () => {
    pending[0].resolve({ source_id: 57, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(created, 1)
  assert.ok(button(tree, '配置另一个 NAS 备份来源'))
  await act(async () => { button(tree, '配置另一个 NAS 备份来源').props.onClick() })
  assert.equal(tree.root.findByType('TextField').props.value, '')
  assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, true,
    'next Source requires new NAS preflight, new target, and new consent')
  await selectNewSource(tree, 'NAS Documents')
  await act(async () => { button(tree, '确认创建并绑定本地目录').props.onClick() })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].slice(0, 4), [SELECTION, SCOPE, 17, 'NAS Documents'])
  await act(async () => {
    pending[1].resolve({ source_id: 58, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(created, 2)
  await act(async () => tree.unmount())
})
test('lost/uncertain Source create ACK cannot unlock new Source or duplicate submission', async () => {
  const responses = []
  let calls = 0
  const client = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    createNASBackupSource: () => {
      calls++
      const p = deferred()
      responses.push(p)
      return p.promise
    },
  }
  const tree = await mountSetup(client, () => {})
  await selectNewSource(tree, 'NAS Photos')
  await act(async () => { button(tree, '确认创建并绑定本地目录').props.onClick() })
  await act(async () => {
    responses[0].resolve({ source_id: 57, state: 'needs_inspection' })
    await Promise.resolve()
  })
  assert.equal(tree.root.findAllByType('Button').some(x =>
    x.props.children === '配置另一个 NAS 备份来源'), false)
  await act(async () => { button(tree, '确认创建并绑定本地目录').props.onClick() })
  assert.equal(calls, 1)
  await act(async () => tree.unmount())
})
test('old Owner/create response must not claim a new Owner Source after the client rotates', async () => {
  const pending = deferred()
  let refreshed = 0
  const ownerA = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    createNASBackupSource: () => pending.promise,
  }
  const ownerB = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: OTHER_SCOPE,
    }),
    createNASBackupSource: () => { throw Error('must never be called') },
  }
  const tree = await mountSetup(ownerA, () => { refreshed++ })
  await selectNewSource(tree, 'NAS Photos')
  await act(async () => { button(tree, '确认创建并绑定本地目录').props.onClick() })
  await act(async () => {
    tree.update(React.createElement(Setup, { client: ownerB, onCreated: () => { refreshed++ } }))
    await Promise.resolve()
  })
  await act(async () => {
    pending.resolve({ source_id: 57, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(refreshed, 0, 'old Owner ACK must not refresh/authorize new Owner')
  assert.equal(tree.root.findAllByType('Button').some(x =>
    x.props.children === '配置另一个 NAS 备份来源'), false)
  await act(async () => tree.unmount())
})
async function mountDraft(client, onBound = () => {}) {
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Drafts, {
      client, ownerScope: SCOPE, selectionID: SELECTION, onBound,
    }))
    await Promise.resolve()
  })
  return tree
}
test('DSM lets users bind next distinct draft only after authorized ACK and a fresh Owner inventory excludes prior draft', async () => {
  let inventory = rows.slice()
  let bound = 0
  const requests = []
  const client = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: inventory }),
    bindNativeDraft: (...args) => {
      const response = deferred()
      requests.push({ args, response })
      return response.promise
    },
  }
  const tree = await mountDraft(client, () => { bound++ })
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => {
    button(tree, '确认绑定这个 Source').props.onClick()
  })
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].args.slice(0, 3), [57, SELECTION, SCOPE])
  inventory = rows.slice(1)
  await act(async () => {
    requests[0].response.resolve({ source_id: 57, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(bound, 1)
  assert.equal(checkbox(tree, '我确认将上方').props.checked, false,
    'new Source must require a fresh explicit checkbox confirmation')
  assert.equal(button(tree, '确认绑定这个 Source').props.disabled, true)
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => { button(tree, '确认绑定这个 Source').props.onClick() })
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].args.slice(0, 3), [58, SELECTION, SCOPE])
  inventory = []
  await act(async () => {
    requests[1].response.resolve({ source_id: 58, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(bound, 2)
  await act(async () => tree.unmount())
})
test('ambiguous native Root bind never unlocks next draft, even after manual inventory refresh', async () => {
  let inventory = rows.slice()
  const pending = deferred()
  let binds = 0
  const client = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: inventory }),
    bindNativeDraft: () => { binds++; return pending.promise },
  }
  const tree = await mountDraft(client)
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => { button(tree, '确认绑定这个 Source').props.onClick() })
  await act(async () => {
    pending.resolve({ source_id: 57, state: 'needs_inspection' })
    await Promise.resolve()
  })
  inventory = rows.slice(1)
  await act(async () => {
    button(tree, '刷新草稿').props.onClick()
    await Promise.resolve()
  })
  await act(async () => { button(tree, '确认绑定这个 Source').props.onClick() })
  assert.equal(binds, 1, 'uncertain original binding must not permit a second native mutation')
  await act(async () => tree.unmount())
})

test('previous share preflight callback cannot authorize a new Source generation after confirmed success', async () => {
  const client = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    createNASBackupSource: async () => ({ source_id: 57, state: 'authorized' }),
  }
  const tree = await mountSetup(client, () => {})
  await selectNewSource(tree, 'NAS Photos')
  const oldVerifier = tree.root.findByType('share-inventory').props.onVerifiedShare
  await act(async () => {
    button(tree, '确认创建并绑定本地目录').props.onClick()
    await Promise.resolve()
  })
  await act(async () => {
    button(tree, '配置另一个 NAS 备份来源').props.onClick()
    await Promise.resolve()
  })
  const newVerifier = tree.root.findByType('share-inventory').props.onVerifiedShare
  assert.notEqual(newVerifier, oldVerifier, 'new Source must have a fresh NAS inventory callback')
  await act(async () => {
    oldVerifier({ label: '/volume1/Photos', selection_id: SELECTION })
  })
  await act(async () => {
    button(tree, '选择云端备份目标').props.onClick()
  })
  await act(async () => {
    tree.root.findByType('cloud-target').props.onSelectTarget({ id: 17, name: 'Backup Target' })
    tree.root.findByType('TextField').props.onChange({ target: { value: 'NAS Documents' } })
    checkbox(tree, '我确认在当前 NAS').props.onChange({ target: { checked: true } })
  })
  assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, true,
    'stale verified share callback cannot satisfy new Source admission')
  await act(async () => {
    newVerifier({ label: '/volume1/Photos', selection_id: SELECTION })
  })
  await act(async () => {
    checkbox(tree, '我确认在当前 NAS').props.onChange({ target: { checked: true } })
  })
  assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, false,
    'new native preflight callback plus explicit consent may authorize the next Source')
  await act(async () => tree.unmount())
})

test('confirmed original draft bind clears share and requires fresh NAS preflight before next draft', async () => {
  let inventory = rows.slice()
  const binds = []
  let refreshes = 0
  const client = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: inventory }),
    bindNativeDraft: (...args) => {
      const promise = deferred()
      binds.push({ args, promise })
      return promise.promise
    },
  }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(SetupWithDrafts, {
      client, onCreated: () => { refreshes++ },
    }))
    await Promise.resolve()
  })
  await act(async () => {
    tree.root.findByType('share-inventory').props.onVerifiedShare({
      label: '/volume1/Photos', selection_id: SELECTION,
    })
    button(tree, '检查未绑定草稿').props.onClick()
    await Promise.resolve()
  })
  const oldVerifier = tree.root.findByType('share-inventory').props.onVerifiedShare
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => {
    button(tree, '确认绑定这个 Source').props.onClick()
  })
  assert.deepEqual(binds[0].args.slice(0, 3), [57, SELECTION, SCOPE])
  inventory = rows.slice(1)
  await act(async () => {
    binds[0].promise.resolve({ source_id: 57, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(refreshes, 1)
  assert.equal(tree.root.findByType(Drafts).props.selectionID, '',
    'a confirmed Root bind must clear the previous NAS share selection')
  await act(async () => {
    oldVerifier({ label: '/volume1/Photos', selection_id: SELECTION })
  })
  assert.equal(tree.root.findByType(Drafts).props.selectionID, '',
    'late previous share response must not reauthorize the next draft')
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
    button(tree, '确认绑定这个 Source').props.onClick()
  })
  assert.equal(binds.length, 1, 'a second Root grant needs a fresh preflight')
  await act(async () => {
    tree.root.findByType('share-inventory').props.onVerifiedShare({
      label: '/volume1/Photos', selection_id: SELECTION,
    })
  })
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => {
    button(tree, '确认绑定这个 Source').props.onClick()
  })
  assert.equal(binds.length, 2)
  assert.deepEqual(binds[1].args.slice(0, 3), [58, SELECTION, SCOPE])
  inventory = []
  await act(async () => {
    binds[1].promise.resolve({ source_id: 58, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(refreshes, 2)
  await act(async () => tree.unmount())
})

test('recovering precisely the pending created Source unlocks next setup, unrelated draft does not', async () => {
  for (const boundSourceID of [57, 58]) {
    let inventory = rows.slice()
    const client = {
      serverConnection: async () => ({
        configured: true, must_change_password: false, owner_scope: SCOPE,
      }),
      createNASBackupSource: async () => ({ source_id: 57, state: 'needs_inspection' }),
      nativeDrafts: async () => ({ owner_scope: SCOPE, items: inventory }),
      bindNativeDraft: async () => {
        inventory = rows.filter(row => row.source_id !== boundSourceID)
        return { source_id: boundSourceID, state: 'authorized' }
      },
    }
    let tree
    await act(async () => {
      tree = Renderer.create(React.createElement(SetupWithDrafts, { client, onCreated: () => {} }))
      await Promise.resolve()
    })
    await selectNewSource(tree, 'NAS Photos')
    await act(async () => {
      button(tree, '确认创建并绑定本地目录').props.onClick()
      await Promise.resolve()
    })
    const options = tree.root.findAllByType('Button')
      .filter(x => x.props.children === '确认绑定这个 Source')
    assert.equal(options.length, 2)
    await act(async () => {
      checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
    })
    await act(async () => {
      options[boundSourceID === 57 ? 0 : 1].props.onClick()
      await Promise.resolve()
    })
    assert.equal(tree.root.findAllByType('Button').some(x =>
      x.props.children === '配置另一个 NAS 备份来源'), boundSourceID === 57,
    'only the previously uncertain Source ID may transition to verified authorized')
    await act(async () => tree.unmount())
  }
})

test('DSM ignores an old Agent Root-bind ACK when the Host client instance changes without an Owner or selection change', async () => {
  const pending = deferred()
  let oldBinds = 0
  let newBinds = 0
  let accepted = 0
  const oldClient = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: rows.slice() }),
    bindNativeDraft: () => { oldBinds++; return pending.promise },
  }
  const newClient = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: rows.slice() }),
    bindNativeDraft: async () => {
      newBinds++
      return { source_id: 57, state: 'authorized' }
    },
  }
  const onBound = () => { accepted++ }
  const tree = await mountDraft(oldClient, onBound)
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  await act(async () => { button(tree, '确认绑定这个 Source').props.onClick() })
  assert.equal(oldBinds, 1)
  await act(async () => {
    tree.update(React.createElement(Drafts, {
      client: newClient, ownerScope: SCOPE, selectionID: SELECTION, onBound,
    }))
    await Promise.resolve()
  })
  await act(async () => {
    pending.resolve({ source_id: 57, state: 'authorized' })
    await Promise.resolve()
  })
  assert.equal(accepted, 0, 'a prior Agent cannot claim authorization for the new Host client')
  assert.equal(newBinds, 0, 'a Host switch never submits a second native Root grant')
  assert.equal(checkbox(tree, '我确认将上方').props.checked, false)
  assert.equal(button(tree, '确认绑定这个 Source').props.disabled, true,
    'an uncertain ACK remains latched until explicit inspection in the owning context')
  const alerts = tree.root.findAllByType('Typography')
    .filter(x => x.props.role === 'alert')
  assert.ok(alerts.length > 0, 'the old Agent ACK must be reported uncertain, not successful')
  await act(async () => tree.unmount())
})

test('DSM requires renewed draft-bind consent when Host client changes without an Owner identity change', async () => {
  const oldClient = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: rows.slice() }),
  }
  const newClient = {
    nativeDrafts: async () => ({ owner_scope: SCOPE, items: rows.slice() }),
  }
  const tree = await mountDraft(oldClient)
  await act(async () => {
    checkbox(tree, '我确认将上方').props.onChange({ target: { checked: true } })
  })
  assert.equal(checkbox(tree, '我确认将上方').props.checked, true)
  await act(async () => {
    tree.update(React.createElement(Drafts, {
      client: newClient, ownerScope: SCOPE, selectionID: SELECTION, onBound: () => {},
    }))
    await Promise.resolve()
  })
  assert.equal(checkbox(tree, '我确认将上方').props.checked, false,
    'same Owner scope is not sufficient proof of identical owning Agent identity')
  await act(async () => tree.unmount())
})
test('DSM Source setup isolates confirmed Root, draft selection and consent on a new owning Host', async () => {
  let oldWrites = 0
  const newWrites = []
  let refreshes = 0
  const ownerA = {
    serverConnection: async () => ({
      configured: true, must_change_password: false, owner_scope: SCOPE,
    }),
    createNASBackupSource: async () => {
      oldWrites++
      return { source_id: 57, state: 'authorized' }
    },
  }
  const ownerBReady = deferred()
  const ownerB = {
    serverConnection: () => ownerBReady.promise,
    createNASBackupSource: async (...args) => {
      newWrites.push(args)
      return { source_id: 58, state: 'authorized' }
    },
  }
  const onCreated = () => { refreshes++ }
  const tree = await mountSetup(ownerA, onCreated)
  await selectNewSource(tree, 'NAS Photos A')
  const oldVerifiedShare = tree.root.findByType('share-inventory').props.onVerifiedShare
  await act(async () => {
    button(tree, '确认创建并绑定本地目录').props.onClick()
    await Promise.resolve()
  })
  assert.equal(oldWrites, 1)
  assert.equal(refreshes, 1)
  assert.ok(button(tree, '配置另一个 NAS 备份来源'),
    'Owner A must reach a real confirmed Source state before switching')

  await act(async () => {
    tree.update(React.createElement(Setup, { client: ownerB, onCreated }))
  })
  const firstFrame = JSON.stringify(tree.toJSON())
  assert.doesNotMatch(firstFrame, /本机 Source 57|配置另一个 NAS 备份来源|NAS Photos A|Backup Target/,
    'the very first render of Owner B must not contain Owner A Source, target, consent or success')
  assert.equal(tree.root.findByType('TextField').props.value, '')
  assert.equal(checkbox(tree, '我确认在当前 NAS').props.checked, false)
  assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, true,
    'Owner B must fail closed while its own Agent identity is being checked')

  await act(async () => {
    ownerBReady.resolve({ configured: true, must_change_password: false, owner_scope: OTHER_SCOPE })
    await Promise.resolve()
    oldVerifiedShare({ label: '/volume1/Photos', selection_id: SELECTION })
  })
  assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, true,
    'a stale prior Host share callback must not grant the new Host Root')
  await selectNewSource(tree, 'NAS Photos B')
  await act(async () => {
    button(tree, '确认创建并绑定本地目录').props.onClick()
    await Promise.resolve()
  })
  assert.deepEqual(newWrites, [[SELECTION, OTHER_SCOPE, 17, 'NAS Photos B']])
  assert.equal(refreshes, 2)
  await act(async () => tree.unmount())
})

test('DSM previous Host in-flight Source ACK cannot contaminate next Host or block fresh setup', async () => {
  for (const result of ['authorized', 'rejected']) {
    const pending = deferred()
    let refreshed = 0
    const ownerA = {
      serverConnection: async () => ({
        configured: true, must_change_password: false, owner_scope: SCOPE,
      }),
      createNASBackupSource: () => pending.promise,
    }
    const callsB = []
    const ownerB = {
      // Equal Owner scope alone does not prove equal owning Agent.
      serverConnection: async () => ({
        configured: true, must_change_password: false, owner_scope: SCOPE,
      }),
      createNASBackupSource: async (...args) => {
        callsB.push(args)
        return { source_id: 58, state: 'authorized' }
      },
    }
    const onCreated = () => { refreshed++ }
    const tree = await mountSetup(ownerA, onCreated)
    await selectNewSource(tree, 'NAS Pending A')
    await act(async () => { button(tree, '确认创建并绑定本地目录').props.onClick() })
    await act(async () => {
      tree.update(React.createElement(Setup, { client: ownerB, onCreated }))
      await Promise.resolve()
    })
    await act(async () => {
      if (result === 'authorized') pending.resolve({ source_id: 57, state: 'authorized' })
      else pending.reject(new Error('old Agent acknowledgement lost'))
      await Promise.resolve()
    })
    assert.equal(refreshed, 0, 'old Agent completion must never refresh the replacement Host')
    assert.doesNotMatch(JSON.stringify(tree.toJSON()),
      /本机 Source 57|创建结果无法确认|配置另一个 NAS 备份来源|NAS Pending A/,
      'neither success nor uncertainty from old Agent may appear for replacement Host')
    assert.equal(button(tree, '确认创建并绑定本地目录').props.disabled, true)
    await selectNewSource(tree, 'NAS Fresh B')
    await act(async () => {
      button(tree, '确认创建并绑定本地目录').props.onClick()
      await Promise.resolve()
    })
    assert.deepEqual(callsB, [[SELECTION, SCOPE, 17, 'NAS Fresh B']],
      'replacement Host accepts only its own freshly verified Source transaction')
    assert.equal(refreshed, 1)
    await act(async () => tree.unmount())
  }
})
