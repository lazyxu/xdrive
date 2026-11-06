// Two complementary, non-credential-bearing guards for the shared HTTPS
// Places map. Promise handlers may ignore AbortSignal: the deadline must
// STILL settle and late results must never cross the current Owner/view.
export const XDRIVE_PLACES_HANDOFF_TIMEOUT_MS = 15_000
export const XDRIVE_PLACES_EMBED_PREPARE_TIMEOUT_MS = 16_000
export const XDRIVE_PLACES_STATUS_TIMEOUT_MS = 12_000

export function xDrivePlacesHandoffTimeValid(
  issuedAt: number, now: number, visible: boolean,
  maxAge = XDRIVE_PLACES_HANDOFF_TIMEOUT_MS,
): boolean {
  return visible && Number.isFinite(issuedAt) && Number.isFinite(now) &&
    Number.isFinite(maxAge) && maxAge > 0 &&
    now >= issuedAt && now-issuedAt < maxAge
}

export function xDrivePlacesRequestWithDeadline<T>(
  request: Promise<T>, signal: AbortSignal, durationMs: number,
  onTimeout?: () => void,
): Promise<T> {
  if (!signal || signal.aborted) return Promise.reject(new Error('places-request-cancelled'))
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 60_000)
    return Promise.reject(new Error('invalid-places-request-deadline'))
  return new Promise<T>((resolve,reject)=>{
    let done=false
    let timer:ReturnType<typeof setTimeout>|null=null
    const dispose=()=>{
      if(timer!==null)clearTimeout(timer)
      signal.removeEventListener('abort',cancel)
    }
    const fail=(error:unknown)=>{
      if(done)return
      done=true
      dispose()
      reject(error)
    }
    const pass=(value:T)=>{
      if(done)return
      done=true
      dispose()
      resolve(value)
    }
    const cancel=()=>fail(new Error('places-request-cancelled'))
    signal.addEventListener('abort',cancel,{once:true})
    timer=setTimeout(()=>{
      if(done)return
      fail(new Error('places-request-timeout'))
      // Abort upstream after resolving the controlled deadline. It may never
      // settle; any late response remains attached to a handled Promise.
      try{onTimeout?.()}catch{/* deadline remains terminal */}
    },durationMs)
    void Promise.resolve(request).then(pass,fail)
    if(signal.aborted)cancel()
  })
}
