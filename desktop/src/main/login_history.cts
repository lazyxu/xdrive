export type StoredLoginProfile = {
  server: string
  username: string
  mount_path?: string
  last_used_at: string
  remember_password: boolean
  auto_login: boolean
  encrypted_password?: string
}

export type LoginHistory = {
  version: 1
  profiles: StoredLoginProfile[]
}

export type PublicLoginProfile = {
  server: string
  username: string
  mount_path?: string
  last_used_at: string
  remember_password: boolean
  auto_login: boolean
  password_available: boolean
}

export type PublicLoginHistory = {
  profiles: PublicLoginProfile[]
  secure_password_storage: boolean
}

const loginHistoryLimit = 50

function profileKey(server: string, username: string) {
  return `${server}\u0000${username}`
}

function validTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

export function emptyLoginHistory(): LoginHistory {
  return { version: 1, profiles: [] }
}

export function normalizeLoginHistory(value: unknown): LoginHistory {
  if (!value || typeof value !== 'object') return emptyLoginHistory()
  const candidate = value as Partial<LoginHistory>
  if (!Array.isArray(candidate.profiles)) return emptyLoginHistory()

  const deduped = new Map<string, StoredLoginProfile>()
  for (const raw of candidate.profiles) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<StoredLoginProfile>
    const server = typeof item.server === 'string' ? item.server.trim() : ''
    const username = typeof item.username === 'string' ? item.username.trim() : ''
    const lastUsedAt = validTimestamp(item.last_used_at)
    if (!server || !username || !lastUsedAt) continue

    const mountPath = typeof item.mount_path === 'string' && item.mount_path.trim()
      ? item.mount_path.trim()
      : undefined
    const encryptedPassword = typeof item.encrypted_password === 'string' && item.encrypted_password
      ? item.encrypted_password
      : undefined
    const rememberPassword = item.remember_password === true && !!encryptedPassword
    const profile: StoredLoginProfile = {
      server,
      username,
      ...(mountPath ? { mount_path: mountPath } : {}),
      last_used_at: lastUsedAt,
      remember_password: rememberPassword,
      auto_login: item.auto_login === true && rememberPassword,
      ...(rememberPassword ? { encrypted_password: encryptedPassword } : {}),
    }
    const key = profileKey(server, username)
    const previous = deduped.get(key)
    if (!previous || Date.parse(profile.last_used_at) > Date.parse(previous.last_used_at)) {
      deduped.set(key, profile)
    }
  }

  const profiles = [...deduped.values()]
    .sort((a, b) => Date.parse(b.last_used_at) - Date.parse(a.last_used_at))
    .slice(0, loginHistoryLimit)

  let autoLoginAssigned = false
  for (const profile of profiles) {
    if (profile.auto_login && !autoLoginAssigned) {
      autoLoginAssigned = true
      continue
    }
    profile.auto_login = false
  }
  return { version: 1, profiles }
}

export function findLoginProfile(history: LoginHistory, server: string, username: string) {
  const normalizedServer = server.trim()
  const normalizedUsername = username.trim()
  return history.profiles.find(
    (profile) => profile.server === normalizedServer && profile.username === normalizedUsername,
  )
}

export function publicLoginHistory(history: LoginHistory, securePasswordStorage: boolean): PublicLoginHistory {
  return {
    secure_password_storage: securePasswordStorage,
    profiles: history.profiles.map((profile) => {
      const passwordAvailable = securePasswordStorage && profile.remember_password && !!profile.encrypted_password
      return {
        server: profile.server,
        username: profile.username,
        ...(profile.mount_path ? { mount_path: profile.mount_path } : {}),
        last_used_at: profile.last_used_at,
        remember_password: passwordAvailable,
        auto_login: passwordAvailable && profile.auto_login,
        password_available: passwordAvailable,
      }
    }),
  }
}

export function recordSuccessfulLogin(
  history: LoginHistory,
  input: {
    server: string
    username: string
    mount_path?: string
    last_used_at: string
    remember_password: boolean
    auto_login: boolean
    encrypted_password?: string
  },
): LoginHistory {
  const current = normalizeLoginHistory(history)
  const server = input.server.trim()
  const username = input.username.trim()
  const existing = findLoginProfile(current, server, username)
  const encryptedPassword = input.remember_password
    ? (input.encrypted_password || existing?.encrypted_password)
    : undefined
  const rememberPassword = input.remember_password && !!encryptedPassword
  const mountPath = input.mount_path?.trim() || undefined
  const profile: StoredLoginProfile = {
    server,
    username,
    ...(mountPath ? { mount_path: mountPath } : {}),
    last_used_at: validTimestamp(input.last_used_at) || new Date().toISOString(),
    remember_password: rememberPassword,
    auto_login: input.auto_login && rememberPassword,
    ...(rememberPassword ? { encrypted_password: encryptedPassword } : {}),
  }
  const rest = current.profiles
    .filter((item) => profileKey(item.server, item.username) !== profileKey(server, username))
    .map((item) => ({ ...item, auto_login: false }))
  return normalizeLoginHistory({ version: 1, profiles: [profile, ...rest] })
}

export function automaticLoginProfile(history: LoginHistory) {
  return history.profiles.find(
    (profile) => profile.auto_login && profile.remember_password && !!profile.encrypted_password,
  )
}

export function disableAutomaticLogin(history: LoginHistory): LoginHistory {
  return normalizeLoginHistory({
    version: 1,
    profiles: history.profiles.map((profile) => ({ ...profile, auto_login: false })),
  })
}

export function replaceSavedPassword(
  history: LoginHistory,
  server: string,
  username: string,
  encryptedPassword: string,
): LoginHistory {
  const normalized = normalizeLoginHistory(history)
  return normalizeLoginHistory({
    version: 1,
    profiles: normalized.profiles.map((profile) => {
      if (profile.server !== server.trim() || profile.username !== username.trim() || !profile.remember_password) {
        return profile
      }
      return { ...profile, encrypted_password: encryptedPassword }
    }),
  })
}
