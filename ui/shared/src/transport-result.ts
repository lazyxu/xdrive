export type XDriveTransportError = {
  message: string
  status?: number
  code?: string
  detail?: string
}

export type XDriveWrappedTransportResult<
  T,
  TError extends XDriveTransportError = XDriveTransportError,
> =
  | { ok: true; data: T }
  | { ok: false; error: TError }

export type XDriveTransportResult<
  T,
  TError extends XDriveTransportError = XDriveTransportError,
> =
  | T
  | XDriveWrappedTransportResult<T, TError>

export function isXDriveWrappedTransportResult<
  T,
  TError extends XDriveTransportError = XDriveTransportError,
>(
  value: XDriveTransportResult<T, TError>,
): value is XDriveWrappedTransportResult<T, TError> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    ('data' in value || 'error' in value),
  )
}

export function xDriveTransportError<TError extends XDriveTransportError>(
  error: TError,
) {
  const result = new Error(error.message) as Error & XDriveTransportError
  if (error.status !== undefined) result.status = error.status
  if (error.code !== undefined) result.code = error.code
  if (error.detail !== undefined) result.detail = error.detail
  return result
}

export async function resolveXDriveTransport<
  T,
  TError extends XDriveTransportError = XDriveTransportError,
>(
  value: Promise<XDriveTransportResult<T, TError>>,
): Promise<T> {
  const result = await value
  if (!isXDriveWrappedTransportResult(result)) return result
  if (result.ok) return result.data
  throw xDriveTransportError(result.error)
}

export async function resolveOptionalXDriveTransport<
  T,
  TError extends XDriveTransportError = XDriveTransportError,
>(
  value: Promise<XDriveTransportResult<T, TError>>,
): Promise<T | undefined> {
  const result = await value
  if (!isXDriveWrappedTransportResult(result)) return result
  return result.ok ? result.data : undefined
}
