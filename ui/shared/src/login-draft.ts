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
  return { server: draft.server, lanIp: draft.lanIp, username: draft.username }
}
