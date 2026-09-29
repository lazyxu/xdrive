import type { ShareStatus } from '../models'
import { XDriveStatusBadge } from './StatusBadge'

const shareStatusView: Record<ShareStatus, { label: string; tone: 'neutral' | 'good' | 'warning' | 'bad' }> = {
  active: { label: '有效', tone: 'good' },
  expired: { label: '已过期', tone: 'neutral' },
  exhausted: { label: '已达上限', tone: 'warning' },
  revoked: { label: '已撤销', tone: 'bad' },
}

export function XDriveShareStatusBadge({ status }: { status: ShareStatus }) {
  const view = shareStatusView[status]
  return <XDriveStatusBadge tone={view.tone} label={view.label} />
}
