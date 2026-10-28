/** Optional PWA performance query hints must never prevent normal Web startup. */
export function xDriveWebStartupSearchParams(): URLSearchParams {
  let observed = ''
  try {
    // Safari/WebKit can deny the Window.location or Location.search getter.
    // A denied/unknown search does not enable any performance harness.
    if (typeof window !== 'undefined') {
      const search = window.location.search
      if (typeof search === 'string') observed = search
    }
  } catch { /* startup remains the ordinary Web application */ }
  return new URLSearchParams(observed)
}
