/** In-memory opt-in Desktop clipboard change filter.
 * Never snapshots the original clipboard content when the watcher is enabled.
 * The first sample only establishes a baseline; local copy-back suppresses echo.
 */
export class XDriveDesktopClipboardObservationGate {
  private seen: string | null = null
  private echo: string | null = null
  consider(text: string, visible: boolean): string | null {
    if (!visible) return null
    if (this.seen === null) { this.seen = text; return null }
    if (text === this.seen) return null
    this.seen = text
    if (text === this.echo) { this.echo = null; return null }
    // Never forward blank/over-limit values to encryption or network.
    if (!text || new TextEncoder().encode(text).length > 65_536) return null
    return text
  }
  suppressLocalWrite(text: string): void {
    this.echo = text
    this.seen = text
  }
  reset(): void { this.seen = null; this.echo = null }
}
