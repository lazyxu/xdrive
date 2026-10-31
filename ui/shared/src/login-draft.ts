/** Public login hints only. Never mix these with tokens, password or Owner proof. */
export type XDriveLoginDraft = Readonly<{
  server: string
  lanIp: string
  username: string
}>

export const xDriveEmptyLoginDraft = (): XDriveLoginDraft => ({
  server: '', lanIp: '', username: '',
})

/** Untrusted local/browser preferences must not flow directly into a Login UI. */
export function xDriveNormalizeLoginDraft(input: unknown): XDriveLoginDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return xDriveEmptyLoginDraft()
  const draft = input as Partial<XDriveLoginDraft> & { version?: unknown }
  if (draft.version !== undefined && draft.version !== 1) return xDriveEmptyLoginDraft()
  const valid = (item: unknown, max: number): item is string =>
    typeof item === 'string' && item.length <= max && !/[\u0000\r\n]/.test(item)
  if (!valid(draft.server, 512) || !valid(draft.lanIp, 128) ||
      !valid(draft.username, 128)) return xDriveEmptyLoginDraft()
  const server = draft.server.trim()
  // The login hint is NOT an arbitrary navigable URL. Never persist URL
  // credentials, paths, search params, fragments or a plaintext HTTP origin.
  if (server) {
    try {
      const url = new URL(server)
      if (url.protocol !== 'https:' || !url.hostname || url.username ||
          url.password || url.pathname !== '/' || url.search || url.hash) {
        return xDriveEmptyLoginDraft()
      }
    } catch { return xDriveEmptyLoginDraft() }
  }
  const ip = draft.lanIp.trim()
  if (ip) {
    const bytes = ip.split('.')
    if (bytes.length !== 4 || bytes.some((part) =>
      !/^(0|[1-9][0-9]{0,2})$/.test(part) ||
      !Number.isInteger(Number(part)) || Number(part) > 255)) {
      return xDriveEmptyLoginDraft()
    }
    const octets = bytes.map(Number)
    if (!(octets[0] === 10 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168))) {
      return xDriveEmptyLoginDraft()
    }
  }
  return { server: draft.server, lanIp: draft.lanIp, username: draft.username }
}
