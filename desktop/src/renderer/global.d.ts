export {}

type DesktopInfo = {
  version: string
  platform: string
  arch: string
}

declare global {
  interface Window {
    xdriveDesktop: {
      getInfo: () => Promise<DesktopInfo>
      hide: () => void
      quit: () => void
    }
  }
}
