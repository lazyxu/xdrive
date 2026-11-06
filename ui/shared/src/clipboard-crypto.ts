// Browser-only E2EE text encoding. No keys or plaintext enter Server, URL,
// Service Worker cache, Web storage or logs.
export const XDRIVE_CLIPBOARD_MAX_TEXT_BYTES = 64 * 1024
export const XDRIVE_CLIPBOARD_KDF_ITERATIONS = 310_000
export type XDriveClipboardKind = 'text/plain' | 'text/uri-list'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof value !== 'string' || !value.length ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error('剪贴板密文格式无效')
  const decoded = atob(value)
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  if (bytesToBase64(bytes) !== value) throw new Error('剪贴板密文格式无效')
  return bytes
}

// WebCrypto BufferSource excludes SharedArrayBuffer-backed typed views in
// recent DOM typings. Copy into a guaranteed ordinary ArrayBuffer instead of
// hiding the mismatch with an unsafe type assertion.
function cryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function secureCrypto(): Crypto {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('加密剪贴板需要 HTTPS 或 localhost 安全环境。')
  }
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues) {
    throw new Error('当前浏览器不支持安全加密，无法发送剪贴板内容。')
  }
  return crypto
}

function associatedData(ownerScope: string, eventID: string, kind: XDriveClipboardKind): Uint8Array {
  return new TextEncoder().encode('xdrive-clipboard-v1|' + ownerScope + '|' + eventID + '|' + kind)
}

export function xDriveClipboardKind(text: string): XDriveClipboardKind {
  return /^https?:\/\/\S+$/i.test(text.trim()) ? 'text/uri-list' : 'text/plain'
}

export function xDriveClipboardValidateText(text: string): void {
  const bytes = new TextEncoder().encode(text)
  if (!bytes.length || bytes.length > XDRIVE_CLIPBOARD_MAX_TEXT_BYTES) {
    throw new Error('剪贴板只支持 1–65536 字节的文本。')
  }
}

export async function xDriveClipboardDeriveKey(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const crypto = secureCrypto()
  if (passphrase.length < 12 || passphrase.length > 256) {
    throw new Error('剪贴板口令须为 12–256 个字符。')
  }
  const salt = base64ToBytes(saltBase64)
  if (salt.length !== 16) throw new Error('剪贴板密钥参数无效。')
  const base = await crypto.subtle.importKey(
    'raw', cryptoBuffer(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: cryptoBuffer(salt), iterations: XDRIVE_CLIPBOARD_KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function xDriveClipboardEncrypt(
  key: CryptoKey, ownerScope: string, clientEventID: string, text: string,
): Promise<{ kind: XDriveClipboardKind; nonce: string; ciphertext: string }> {
  xDriveClipboardValidateText(text)
  const crypto = secureCrypto()
  const kind = xDriveClipboardKind(text)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: cryptoBuffer(iv), additionalData: cryptoBuffer(associatedData(ownerScope, clientEventID, kind)) },
    key, cryptoBuffer(new TextEncoder().encode(text)),
  ))
  return { kind, nonce: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) }
}

export async function xDriveClipboardDecrypt(
  key: CryptoKey, ownerScope: string,
  item: { client_event_id: string; kind: XDriveClipboardKind; nonce: string; ciphertext: string },
): Promise<string> {
  const crypto = secureCrypto()
  if (item.kind !== 'text/plain' && item.kind !== 'text/uri-list') {
    throw new Error('不支持的剪贴板类型。')
  }
  const iv = base64ToBytes(item.nonce)
  if (iv.length !== 12) throw new Error('剪贴板随机数格式无效。')
  const encrypted = base64ToBytes(item.ciphertext)
  if (encrypted.length < 17 || encrypted.length > XDRIVE_CLIPBOARD_MAX_TEXT_BYTES + 16) {
    throw new Error('剪贴板密文大小无效。')
  }
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: cryptoBuffer(iv), additionalData: cryptoBuffer(associatedData(ownerScope, item.client_event_id, item.kind)) },
    key, cryptoBuffer(encrypted),
  )
  const text = new TextDecoder('utf-8', { fatal: true }).decode(plain)
  xDriveClipboardValidateText(text)
  return text
}

const vaultCheckEventID = '00000000-0000-4000-8000-000000000001'
const vaultCheckPlaintext = 'xDrive Clipboard Vault v1'

export async function xDriveClipboardMakeVaultCheck(
  key: CryptoKey, ownerScope: string,
): Promise<{ nonce: string; ciphertext: string }> {
  const { nonce, ciphertext } = await xDriveClipboardEncrypt(
    key, ownerScope, vaultCheckEventID, vaultCheckPlaintext,
  )
  return { nonce, ciphertext }
}

export async function xDriveClipboardVerifyVaultCheck(
  key: CryptoKey, ownerScope: string, check: { nonce: string; ciphertext: string },
): Promise<void> {
  try {
    const text = await xDriveClipboardDecrypt(key, ownerScope, {
      kind: 'text/plain', client_event_id: vaultCheckEventID,
      nonce: check.nonce, ciphertext: check.ciphertext,
    })
    if (text === vaultCheckPlaintext) return
  } catch { /* Wrong passphrase or corrupted canary: never unlock. */ }
  throw new Error('剪贴板口令不正确，或密钥校验已损坏。')
}
