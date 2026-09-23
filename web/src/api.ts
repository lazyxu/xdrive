export type NodeType = 'dir' | 'file'

export interface Node {
  id: number
  parent_id?: number
  name: string
  type: NodeType
  size: number
  created_at: string
  updated_at: string
}

export interface AuthResult {
  token: string
  username: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export class XDriveApi {
  private token: string

  constructor(token = '') {
    this.token = token
  }

  setToken(token: string) {
    this.token = token
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
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
    })
  }

  register(username: string, password: string) {
    return this.request<AuthResult>('/api/v1/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password }),
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
    // XMLHttpRequest is intentional here: fetch does not expose upload progress.
    return new Promise<Node>((resolve, reject) => {
      const form = new FormData()
      form.append('file', file, file.name)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/api/v1/nodes/${parentID}/files`)
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
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

  rename(nodeID: number, name: string) {
    return this.request<Node>(`/api/v1/nodes/${nodeID}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    })
  }

  remove(nodeID: number) {
    return this.request<void>(`/api/v1/nodes/${nodeID}`, { method: 'DELETE' })
  }

  downloadURL(nodeID: number) {
    return `${API_BASE}/api/v1/files/${nodeID}/content`
  }

  async download(node: Node) {
    const response = await fetch(this.downloadURL(node.id), {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
    })
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
