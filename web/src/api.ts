export type NodeType = 'dir' | 'file'

export interface Node {
  id: number
  parent_id?: number
  name: string
  type: NodeType
  size: number
  revision: number
  created_at: string
  updated_at: string
}

export interface AuthResult {
  token: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  refresh_expires_in: number
  username: string
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export function sessionFromAuth(result: AuthResult): AuthSession {
  return {
    accessToken: result.access_token || result.token,
    refreshToken: result.refresh_token,
    accessExpiresAt: Date.now() + Math.max(0, result.expires_in) * 1000,
  }
}

export class XDriveApi {
  private session: AuthSession
  private readonly onSession?: (session: AuthSession) => void
  private refreshPromise: Promise<void> | null = null

  constructor(session?: Partial<AuthSession>, onSession?: (session: AuthSession) => void) {
    this.session = {
      accessToken: session?.accessToken ?? '',
      refreshToken: session?.refreshToken ?? '',
      accessExpiresAt: session?.accessExpiresAt ?? 0,
    }
    this.onSession = onSession
  }

  private setSession(session: AuthSession) {
    this.session = session
    this.onSession?.(session)
  }

  private async refresh(force = false) {
    if (!this.session.refreshToken) throw new ApiError(401, 'Session expired')
    if (!force && this.session.accessExpiresAt > Date.now() + 120_000) return
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.session.refreshToken }),
      })
      if (!response.ok) {
        let message = 'Session expired'
        try {
          const body = (await response.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // Keep generic message.
        }
        throw new ApiError(response.status, message)
      }
      const result = (await response.json()) as AuthResult
      this.setSession(sessionFromAuth(result))
    })()

    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async ensureFresh() {
    if (this.session.refreshToken && this.session.accessExpiresAt > 0 && this.session.accessExpiresAt <= Date.now() + 120_000) {
      await this.refresh()
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    await this.ensureFresh()
    const headers = new Headers(init.headers)
    if (this.session.accessToken) headers.set('Authorization', `Bearer ${this.session.accessToken}`)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    let response = await fetch(`${API_BASE}${path}`, { ...init, headers })
    if (response.status === 401 && retry && this.session.refreshToken) {
      await this.refresh(true)
      const retryHeaders = new Headers(init.headers)
      if (this.session.accessToken) retryHeaders.set('Authorization', `Bearer ${this.session.accessToken}`)
      if (init.body && !(init.body instanceof FormData) && !retryHeaders.has('Content-Type')) {
        retryHeaders.set('Content-Type', 'application/json')
      }
      response = await fetch(`${API_BASE}${path}`, { ...init, headers: retryHeaders })
    }
    if (!response.ok) {
      let message = response.statusText || 'Request failed'
      try {
        const body = (await response.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // Keep the HTTP status text when the response is not JSON.
      }
      throw new ApiError(response.status, message)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  login(username: string, password: string) {
    return this.request<AuthResult>('/api/v1/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }, false)
  }

  register(username: string, password: string) {
    return this.request<AuthResult>('/api/v1/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }, false)
  }

  async logout() {
    if (!this.session.refreshToken) return
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    })
  }

  me() {
    return this.request<{ id: number; username: string }>('/api/v1/me')
  }

  root() {
    return this.request<Node>('/api/v1/nodes/root')
  }

  list(parentID: number) {
    return this.request<Node[]>(`/api/v1/nodes/${parentID}/children`)
  }

  createDirectory(parentID: number, name: string) {
    return this.request<Node>(`/api/v1/nodes/${parentID}/directories`, {
      method: 'POST', body: JSON.stringify({ name }),
    })
  }

  async upload(parentID: number, file: File, onProgress?: (percent: number) => void): Promise<Node> {
    await this.ensureFresh()
    return new Promise<Node>((resolve, reject) => {
      const form = new FormData()
      form.append('file', file, file.name)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/api/v1/nodes/${parentID}/files`)
      if (this.session.accessToken) xhr.setRequestHeader('Authorization', `Bearer ${this.session.accessToken}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onload = () => {
        let body: { error?: string } | Node | undefined
        try { body = JSON.parse(xhr.responseText) as { error?: string } | Node } catch { body = undefined }
        if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Node)
        else reject(new ApiError(xhr.status, (body as { error?: string } | undefined)?.error || xhr.statusText || 'Upload failed'))
      }
      xhr.onerror = () => reject(new Error('Network error while uploading'))
      xhr.send(form)
    })
  }

  rename(nodeID: number, revision: number, name: string) {
    return this.request<Node>(`/api/v1/nodes/${nodeID}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ name }),
    })
  }

  remove(nodeID: number, revision: number) {
    return this.request<void>(`/api/v1/nodes/${nodeID}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  downloadURL(nodeID: number) {
    return `${API_BASE}/api/v1/files/${nodeID}/content`
  }

  async download(node: Node) {
    await this.ensureFresh()
    let response = await fetch(this.downloadURL(node.id), {
      headers: this.session.accessToken ? { Authorization: `Bearer ${this.session.accessToken}` } : undefined,
    })
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true)
      response = await fetch(this.downloadURL(node.id), {
        headers: { Authorization: `Bearer ${this.session.accessToken}` },
      })
    }
    if (!response.ok) throw new ApiError(response.status, response.statusText || 'Download failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = node.name
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}
