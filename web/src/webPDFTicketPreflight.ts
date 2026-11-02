/**
 * Web/PWA-only PDF ticket gate. A PDF iframe's load event also fires for
 * HTTP 401/404 HTML error documents; a signed URL is not proof that its
 * bytes are a PDF. The ticket is supplied exclusively by XDriveApi's
 * validated filePreviewURL (never from arbitrary user-provided URLs).
 *
 * Use the same AbortSignal as the ticket read so replacing a Viewer or
 * pressing Back cancels the HEAD request before any iframe is mounted.
 */
export async function xDrivePreflightWebPDFTicket(
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  const base = typeof window === 'undefined'
    ? 'https://xdrive.invalid/'
    : window.location.href
  let parsed: URL
  try {
    parsed = new URL(url, base)
  } catch {
    throw new Error('Invalid PDF preview ticket')
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username || parsed.password ||
      !/^\/api\/v1\/file-preview\/[0-9]+$/.test(parsed.pathname) ||
      parsed.searchParams.size !== 1 ||
      !parsed.searchParams.get('ticket')) {
    throw new Error('Invalid PDF preview ticket')
  }
  if (signal?.aborted) throw new DOMException('PDF preview cancelled', 'AbortError')
  // The shared FilePreviewSurface already performs this same-origin HEAD
  // (including its own iframe status gate). Avoid duplicate reads of the
  // signed stream. Cross-origin trusted API_BASE needs this Web-only gate.
  if (parsed.origin === new URL(base).origin) return
  const response = await fetch(parsed.toString(), {
    method: 'HEAD',
    signal,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  })
  if (signal?.aborted) throw new DOMException('PDF preview cancelled', 'AbortError')
  if (response.status !== 200 && response.status !== 206) {
    throw new Error('PDF preview stream is not available')
  }
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/pdf') {
    throw new Error('PDF preview returned a non-PDF resource')
  }
}
