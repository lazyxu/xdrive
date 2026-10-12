/** Only browser-owned foreground uploads, not Server's durable tasks or handed-off downloads. */
export type XDrivePwaTransferScope = {
  direction: string
  state: string
}
export function xDriveHasPendingBrowserUpload(tasks: readonly XDrivePwaTransferScope[]): boolean {
  return tasks.some(task => task.direction === 'upload' && (
    task.state === 'queued' || task.state === 'running' ||
    task.state === 'retrying' || task.state === 'cancelling'
  ))
}
/** Native browser prompt is best-effort; iOS Safari may skip beforeunload altogether. */
export function xDriveWarnBeforeLeavingUpload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}
