export interface XDriveReleaseBundleArtifact {
  platform: 'ios' | 'android' | 'windows' | 'linux' | 'dsm' | 'cli'
  filename: string
  build_commit: string
  sha256: string
  size: number
  install_mode: 'manual' | 'manual_test_only'
  cached: boolean
  /** Host-owned per-artifact cache result, not an installation guarantee. */
  cache_status: 'pending' | 'verified' | 'missing_upstream' | 'verification_failed' | 'retry_needed' | 'unavailable'
  download_urls: string[]
}

export interface XDriveReleaseBundleState {
  state: 'unavailable' | 'syncing' | 'paused_for_server' | 'retry_needed' | 'ready'
  commit?: string
  channel?: 'master' | 'stable'
  /** Installed binary/package version, separate from full Commit identity. */
  server_version?: string
  cached_commit?: string
  artifacts: XDriveReleaseBundleArtifact[]
  message?: string
}

export interface XDriveReleaseBundlePort {
  getState: () => Promise<XDriveReleaseBundleState>
  retry?: () => Promise<unknown>
  downloadCached?: (filename: string) => Promise<void>
  /** Explicit opt-in install on a trusted native Desktop, never an auto-push. */
  platform?: 'windows' | 'linux'
  installCurrent?: (commit: string, filename: string, personalUnsigned?: boolean) => Promise<void>
}

/** Ordered URLs are advisory sources, never permission to install unverified bytes.
 * Every Client's native transport must validate SHA-256, byte count, application
 * identity/signature and platform compatibility before installation.
 */
export function xDriveReleaseBundleDownloadSources(
  artifact: XDriveReleaseBundleArtifact,
): string[] {
  if (!/^[0-9a-f]{40}$/.test(artifact.build_commit) ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) || artifact.size <= 0 ||
      artifact.download_urls.length > 3) return []
  const basename = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$/
  if (!basename.test(artifact.filename)) return []
  // Python's immutable manifest publisher uses urllib.parse.quote; for
  // the admitted filename alphabet encodeURIComponent is identical, notably
  // '+' -> '%2B'. Do not accept alternate, unescaped mirror URLs.
  const filename = encodeURIComponent(artifact.filename)
  const github = `https://github.com/lazyxu/xdrive/releases/download/bundle-${artifact.build_commit}/${filename}`
  const gitlab = `http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-${artifact.build_commit}/${filename}`
  const local = `/api/v1/release-bundles/current/artifacts/${filename}`
  const expected = artifact.cached ? [local, gitlab, github] : [gitlab, github]
  return expected.every((item, index) => item === artifact.download_urls[index]) &&
    expected.length === artifact.download_urls.length ? expected : []
}
