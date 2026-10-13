/** Only browser-owned foreground uploads, not Server's durable tasks or handed-off downloads. */
export type XDrivePwaTransferScope = {
  direction: string
  state: string
}
const pendingStates = new Set(['queued', 'running', 'retrying', 'cancelling'])
export function xDriveHasPendingBrowserUpload(tasks: readonly XDrivePwaTransferScope[]): boolean {
  return tasks.some(task => task.direction === 'upload' && pendingStates.has(task.state))
}
/** Download events held by THIS browser only; native hand-offs cannot be proven here. */
export function xDriveHasPendingBrowserDownload(tasks: readonly XDrivePwaTransferScope[]): boolean {
  return tasks.some(task => task.direction === 'download' && pendingStates.has(task.state))
}
/** Native browser prompt is best-effort; iOS Safari may skip beforeunload altogether. */
export function xDriveWarnBeforeLeavingUpload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}
