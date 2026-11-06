// The sandboxed HTTPS Places guest uses Chromium's own network service.
// Its certificate decision must match the app-local trusted LAN CA already
// approved for the native Go Agent, without installing a global/root CA.
import { X509Certificate, createHash } from 'node:crypto'
import { isIP } from 'node:net'
import * as tls from 'node:tls'
import {
  privateLANOrigin, verifiedLANRootPEM, type TrustedLANRoot,
} from './lan_root_auto.cjs'

export type PlacesCertificateRequest = {
  hostname: string
  errorCode: number
  certificate?: { data?: string }
}
type FingerprintProbe = (ip: string, port: number, ca: string) => Promise<string | null>

// A second native TLS connection verifies exactly the same peer leaf
// Chromium saw. Node validates chain, validity dates and the real IP SAN
// against the previously approved CA. Never use rejectUnauthorized:false.
export function readTrustedPlacesLANPeerFingerprint(
  ip: string, port: number, ca: string,
): Promise<string | null> {
  const root = verifiedLANRootPEM(ca)
  if (isIP(ip) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !root) return Promise.resolve(null)
  return new Promise(resolve => {
    let finished = false
    const socket = tls.connect({
      host: ip, port, servername: '', ca: root.pem,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      checkServerIdentity: (_host, cert) => tls.checkServerIdentity(ip, cert),
    }, () => {
      try {
        const peer = socket.getPeerCertificate(true)
        if (!socket.authorized || !peer || !Buffer.isBuffer(peer.raw)) {
          finish(null)
          return
        }
        finish(createHash('sha256').update(peer.raw).digest('hex'))
      } catch { finish(null) }
    })
    const finish = (value: string | null) => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(value)
    }
    socket.once('error', () => finish(null))
    socket.setTimeout(6000, () => finish(null))
  })
}

// Only the exact app-approved private IP host may receive a certificate
// override. Electron's cache makes this decision session-lifetime-bound:
// callers must rotate the nonpersistent Session on Owner/CA revocation.
export async function verifyDesktopPlacesLANCertificate(
  request: PlacesCertificateRequest,
  pin: TrustedLANRoot,
  origin: string,
  stillCurrent: () => boolean,
  probe: FingerprintProbe = readTrustedPlacesLANPeerFingerprint,
): Promise<number> {
  const target = privateLANOrigin(origin)
  if (!target || request.hostname !== target.ip) return -3 // Chromium default
  const root = verifiedLANRootPEM(pin.root_pem)
  if (!root || root.sha256 !== pin.sha256 || pin.server !== target.origin ||
      !stillCurrent()) return -2
  // Never override expiry, revocation, name, weak-key or other SSL errors.
  // Chromium's ordinary private-CA error is ERR_CERT_AUTHORITY_INVALID (-202).
  if (request.errorCode !== 0 && request.errorCode !== -202) return -2
  const pem = request.certificate?.data
  if (typeof pem !== 'string' || pem.length < 1 || pem.length > 16384) return -2
  let fingerprint: string
  try {
    const leaf = new X509Certificate(pem)
    const now = Date.now()
    if (leaf.checkIP(target.ip) !== target.ip ||
        Date.parse(leaf.validFrom) > now || Date.parse(leaf.validTo) <= now) return -2
    fingerprint = createHash('sha256').update(leaf.raw).digest('hex')
  } catch { return -2 }
  try {
    const peer = await probe(target.ip, target.port, root.pem)
    return stillCurrent() && peer !== null && peer === fingerprint ? 0 : -2
  } catch { return -2 }
}

// A map provider cannot turn a private certificate override into a local
// intranet/browser SSRF capability. Public HTTPS SDK hosts keep default TLS.
export function placesGuestIPRequestAllowed(
  url: string, approvedOrigin: string | null,
): boolean {
  try {
    const target = new URL(url)
    const ip = target.hostname.replace(/^\[|\]$/g, '')
    // Never allow mixed-content, file, localhost or arbitrary subprotocol
    // requests from the provider-controlled SDK inside the Cookie partition.
    if (!['https:', 'wss:', 'data:', 'blob:', 'about:'].includes(target.protocol)) return false
    // Provider-supplied public hostnames must not reach local host services
    // by using a non-IP spelling for loopback or a single-label LAN name.
    if (ip === 'localhost' || ip.endsWith('.localhost') ||
        ip.endsWith('.local') || (ip !== '' && !ip.includes('.') && isIP(ip) === 0)) {
      return false
    }
    if (isIP(ip) !== 0) {
      return target.protocol === 'https:' && approvedOrigin !== null &&
        target.origin === approvedOrigin
    }
    return true
  } catch { return false }
}
