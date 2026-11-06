'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const auth = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeOwnerLoginModel.swift'), 'utf8')

test('coalescing only shares an in-flight Owner proof for the same login generation', () => {
  assert.match(auth, /struct AuthorizationFlight/)
  assert.match(auth, /running\.generation == ticket/)
  assert.match(auth, /task: Task \{ try await self\.verifyAuthorizationDirect\(\) \}/)
  assert.match(auth, /authorizationFlight\?\.id == flight\.id/)
  assert.match(auth, /let verified = try await flight\.task\.value/)
  assert.match(auth, /try Task\.checkCancellation\(\)/)
  assert.match(auth, /generation == ticket, let activeOwner = owner/)
  assert.match(auth, /sameScope\(verified\.owner, activeOwner\)/)
})

test('single-flight preserves original HTTPS Owner/root verification and refresh checks', () => {
  assert.match(auth, /private func verifyAuthorizationDirect\(\) async throws/)
  assert.match(auth, /XDriveNativeOwnerRootVerifier\(/)
  assert.match(auth, /catch XDriveNativeOwnerRootFailure\.serverStatus\(401\)/)
  assert.match(auth, /fresh = try await XDriveNativeOwnerRootVerifier\(/)
  assert.match(auth, /sameScope\(fresh, snapshot\.verifiedOwner\)/)
  assert.match(auth, /latest\.refreshToken == snapshot\.refreshToken/)
})
