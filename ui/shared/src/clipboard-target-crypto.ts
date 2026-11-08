/** Clipboard v2 targeted E2EE. The Server sees only public X25519
 * material, an ephemeral public key, and AES-GCM ciphertexts. It never
 * receives an unwrapped content key or recipient private key.
 *
 * Wire: `ephemeral_key` = base64 32-byte ephemeral X25519 public key,
 * `wrapped_key` = base64 12-byte IV || 32-byte encrypted content key
 * || 16-byte AES-GCM tag. The `nonce`/`ciphertext` fields contain the
 * separately encrypted content. Event, Owner AAD, type, target and Node ID
 * are bound in both AEAD operations. No plaintext fallback.
 */
export type XDriveClipboardTargetKind =
  | 'text/plain' | 'text/uri-list'
  | 'image/x-xdrive-node-ref' | 'application/x-xdrive-node-ref'

export type XDriveClipboardTargetWire = {
  client_event_id: string
  target_device_id: string
  kind: XDriveClipboardTargetKind
  nonce: string
  ciphertext: string
  ephemeral_key: string
  wrapped_key: string
  node_id?: number
}

const encoder = new TextEncoder()
const maxBytes = 65_536
const targetContext = 'xdrive-clipboard-target-v1'

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.length)
  new Uint8Array(output).set(bytes)
  return output
}
function rawCrypto(): Crypto {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    throw new Error('设备定向加密仅在 HTTPS / localhost 下可用')
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues)
    throw new Error('此环境无法使用 WebCrypto X25519')
  return crypto
}
function decode(raw: string, bytes: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))
    throw new Error('设备加密元数据格式错误')
  const decoded = Uint8Array.from(atob(raw), s => s.charCodeAt(0))
  if (decoded.length !== bytes || encode(decoded) !== raw)
    throw new Error('设备加密元数据长度错误')
  return decoded
}
function encode(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i])
  return btoa(result)
}
function validKind(kind: string, nodeID: number): kind is XDriveClipboardTargetKind {
  if (kind === 'text/plain' || kind === 'text/uri-list') return nodeID === 0
  return (kind === 'image/x-xdrive-node-ref' || kind === 'application/x-xdrive-node-ref') &&
    Number.isSafeInteger(nodeID) && nodeID > 0
}
function context(scope: string, id: string, target: string): string {
  if (!scope || scope.length > 512 || !/^[0-9a-f-]{36}$/i.test(id) ||
      !/^[0-9a-f-]{36}$/i.test(target))
    throw new Error('设备加密身份无效')
  return [targetContext, scope, id, target].join('|')
}
async function wrappingKey(shared: ArrayBuffer, ctx: string): Promise<CryptoKey> {
  const subtle = rawCrypto().subtle
  const kdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const salt = await subtle.digest('SHA-256', asBuffer(encoder.encode(ctx + '|salt')))
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt,
      info: asBuffer(encoder.encode(ctx + '|wrap')) },
    kdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function xDriveClipboardNewTargetKey(): Promise<{
  public_key: string; privateKey: CryptoKey
}> {
  const subtle = rawCrypto().subtle
  // A device retains this privateKey in its native secure credential store;
  // the Browser never uploads or logs it.
  const pair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
  return { public_key: encode(publicKey), privateKey: pair.privateKey }
}
export async function xDriveClipboardEncryptForDevice(
  scope: string, targetID: string, publicKeyBase64: string,
  eventID: string, kind: XDriveClipboardTargetKind, plaintext: string,
  nodeID = 0,
): Promise<XDriveClipboardTargetWire> {
  const wc = rawCrypto()
  const subtle = wc.subtle
  if (!validKind(kind, nodeID)) throw new Error('文件 Node 类型无效')
  const clear = encoder.encode(plaintext)
  if (clear.length === 0 || clear.length > maxBytes) throw new Error('消息大小超出允许范围')
  const base = context(scope, eventID, targetID)
  const target = await subtle.importKey('raw', asBuffer(decode(publicKeyBase64, 32)),
    { name: 'X25519' }, false, [])
  const ephemeral = await subtle.generateKey({ name: 'X25519' }, true,
    ['deriveBits']) as CryptoKeyPair
  const publicEphemeral = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey))
  const shared = await subtle.deriveBits({ name: 'X25519', public: target },
    ephemeral.privateKey, 256)
  const wrapKey = await wrappingKey(shared, base)
  const messageKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt'])
  const keyMaterial = await subtle.exportKey('raw', messageKey)
  const keyNonce = wc.getRandomValues(new Uint8Array(12))
  const wrapAAD = asBuffer(encoder.encode(base + '|key|' + kind + '|' + nodeID))
  const sealedKey = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: asBuffer(keyNonce), additionalData: wrapAAD },
    wrapKey, keyMaterial))
  const wrapped = new Uint8Array(keyNonce.length + sealedKey.length)
  wrapped.set(keyNonce)
  wrapped.set(sealedKey, keyNonce.length)
  const nonce = wc.getRandomValues(new Uint8Array(12))
  const contentAAD = asBuffer(encoder.encode(base + '|content|' + kind + '|' + nodeID))
  const ciphertext = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: asBuffer(nonce), additionalData: contentAAD },
    messageKey, asBuffer(clear)))
  return { client_event_id: eventID, kind, target_device_id: targetID,
    ephemeral_key: encode(publicEphemeral), wrapped_key: encode(wrapped),
    nonce: encode(nonce), ciphertext: encode(ciphertext),
    ...(nodeID > 0 ? { node_id: nodeID } : {}) }
}
export async function xDriveClipboardDecryptForDevice(
  scope: string, privateKey: CryptoKey, wire: XDriveClipboardTargetWire,
): Promise<string> {
  const subtle = rawCrypto().subtle
  const nodeID = wire.node_id ?? 0
  if (!validKind(wire.kind, nodeID)) throw new Error('消息类型错误')
  const base = context(scope, wire.client_event_id, wire.target_device_id)
  const ephemeral = await subtle.importKey('raw', asBuffer(decode(wire.ephemeral_key, 32)),
    { name: 'X25519' }, false, [])
  const shared = await subtle.deriveBits({ name: 'X25519', public: ephemeral },
    privateKey, 256)
  const wrapKey = await wrappingKey(shared, base)
  const sealedKey = decode(wire.wrapped_key, 60)
  const wrapAAD = asBuffer(encoder.encode(base + '|key|' + wire.kind + '|' + nodeID))
  const contentKeyBytes = await subtle.decrypt(
    { name: 'AES-GCM', iv: asBuffer(sealedKey.slice(0,12)), additionalData: wrapAAD },
    wrapKey, asBuffer(sealedKey.slice(12)))
  const contentKey = await subtle.importKey('raw', contentKeyBytes, { name: 'AES-GCM' },
    false, ['decrypt'])
  const ciphertext = wire.ciphertext
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || ciphertext.length > 90_000)
    throw new Error('消息密文无效')
  const data = Uint8Array.from(atob(ciphertext), s => s.charCodeAt(0))
  if (data.length < 17 || data.length > maxBytes + 16)
    throw new Error('消息密文超出限额')
  const contentAAD = asBuffer(encoder.encode(base + '|content|' + wire.kind + '|' + nodeID))
  const clear = await subtle.decrypt({ name: 'AES-GCM',
      iv: asBuffer(decode(wire.nonce,12)), additionalData: contentAAD },
    contentKey, asBuffer(data))
  const text = new TextDecoder('utf-8', { fatal: true }).decode(clear)
  if (!text || encoder.encode(text).length > maxBytes)
    throw new Error('消息明文无效')
  return text
}
