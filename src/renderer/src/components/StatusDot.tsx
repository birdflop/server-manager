import type { ReactElement } from 'react'
import type { ServerStatus } from '@shared/types'

const COLOR: Record<ServerStatus, string> = {
  stopped: 'bg-fg-muted/40',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse'
}

export function StatusDot({
  status,
  size = 8
}: {
  status: ServerStatus
  size?: number
}): ReactElement {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${COLOR[status]}`}
      style={{ width: size, height: size }}
      title={status}
    />
  )
}
