import { Chip } from '@mui/material'
import type { PersonStatus } from '../../types'

const statusColors: Record<PersonStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  ONLINE: 'success',
  MOVING: 'info',
  STATIONARY: 'warning',
  OFFLINE: 'default',
  ON_BREAK: 'warning',
  CHECKED_IN: 'success',
  CHECKED_OUT: 'default',
  EMERGENCY: 'error',
}

export function StatusBadge({ label }: { label: PersonStatus }) {
  return <Chip size="small" label={label} color={statusColors[label]} variant="outlined" />
}
