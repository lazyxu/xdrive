/** Administrator-only offline transport. Upload receipts are NOT publisher trust. */
export interface XDriveOfflineImportFile {
  name: string
  state: 'uploading' | 'ready'
  size: number
  uploaded_bytes: number
  upload_sha256?: string
}

export interface XDriveOfflineImportStatus {
  id: string
  files: XDriveOfflineImportFile[]
  chunk_bytes: number
  ready_to_verify: boolean
}

export interface XDriveOfflineImportSummary {
  id: string
  modified_at: string
}

export interface XDriveOfflineImportPort {
  list: () => Promise<{ items: XDriveOfflineImportSummary[] }>
  create: () => Promise<{ id: string; chunk_bytes: number }>
  get: (id: string) => Promise<XDriveOfflineImportStatus>
  register: (id: string, name: string, size: number, uploadSHA256?: string) => Promise<void>
  putChunk: (id: string, name: string, index: number, data: Blob, chunkSHA256: string, signal?: AbortSignal) => Promise<void>
  finalize: (id: string, name: string) => Promise<{ name: string; state: 'ready'; upload_sha256: string }>
  remove: (id: string) => Promise<void>
  start: (id: string, manifestSHA256: string, goSHA256: string, backupFileData: boolean) => Promise<void>
}

export const XDRIVE_OFFLINE_CHUNK_BYTES = 8 * 1024 * 1024

const fileName = /^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[0-9a-f]{12}\.tar\.gz$/
const digest = /^[0-9a-f]{64}$/
const importID = /^[0-9a-f]{32}$/

export function xDriveValidOfflineFilename(name: string): boolean {
  return ['manifest.json', 'xdrive-offline-linux-amd64',
    'delivery.json', 'delivery-attestation.jsonl'].includes(name) || fileName.test(name)
}

export function xDriveValidOfflineDigest(value: string): boolean {
  return digest.test(value)
}

export function xDriveValidOfflineImportID(value: string): boolean {
  return importID.test(value)
}
