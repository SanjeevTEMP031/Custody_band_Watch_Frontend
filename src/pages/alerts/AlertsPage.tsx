import { useCallback, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { acknowledgeAlert, listAlerts, resolveAlert } from '../../services/api'

function formatDate(val?: string) {
  if (!val) return '—'
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? val : d.toLocaleString()
}

function AlertsPage() {
  const [actionError, setActionError] = useState('')
  const loadAlerts = useCallback(() => listAlerts(0, 500), [])
  const { data: alerts, loading, error, reload } = useApiData(loadAlerts)

  const runAction = async (id: number, action: 'acknowledge' | 'resolve') => {
    setActionError('')
    try {
      if (action === 'acknowledge') await acknowledgeAlert(id)
      else await resolveAlert(id)
      reload()
    } catch (reason) {
      let errorMsg = 'Unable to update alert.'
      if (reason instanceof Error) {
        try {
          const parsed = JSON.parse(reason.message)
          if (Array.isArray(parsed) && parsed[0]?.msg) {
            errorMsg = parsed[0].msg
          } else if (parsed?.detail) {
            errorMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)
          } else {
            errorMsg = reason.message
          }
        } catch {
          errorMsg = reason.message
        }
      }
      setActionError(errorMsg)
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700, color: '#071a2e' }}>
          Alerts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Monitoring and security incident management
        </Typography>
      </Box>

      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}

      <Card sx={{ borderRadius: 3, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
        <CardContent sx={{ p: 0 }}>
          <Table>
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Device</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Alert Type</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Message</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Severity</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {alerts?.map((alert) => {
                const sev = (alert?.severity || 'high').toLowerCase()
                const status = (alert?.status || 'NEW').toLowerCase()
                const typeText = alert?.type || (alert as any)?.alert_type || 'ALARM'
                const msgText = alert?.message || typeText

                return (
                  <TableRow key={alert.id} hover>
                    <TableCell sx={{ fontSize: 13, color: '#64748b' }}>
                      {formatDate(alert.created_at || (alert as any).timestamp)}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>
                      {alert.device_name || alert.device_id || alert.imei || 'Band'}
                    </TableCell>
                    <TableCell>
                      <Chip label={typeText} size="small" sx={{ fontWeight: 600, fontSize: 11 }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 13, color: '#334155' }}>
                      {msgText}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', color: '#475569' }}>
                      {alert.latitude != null && alert.longitude != null && Number.isFinite(alert.latitude) && Number.isFinite(alert.longitude)
                        ? `${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={alert?.severity || (sev === 'critical' ? 'critical' : 'warning')}
                        size="small"
                        color={sev === 'critical' ? 'error' : sev === 'high' ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                      {alert?.status || 'NEW'}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {status !== 'acknowledged' && status !== 'resolved' && (
                          <Button size="small" variant="outlined" onClick={() => void runAction(alert.id, 'acknowledge')}>
                            Acknowledge
                          </Button>
                        )}
                        {status !== 'resolved' && (
                          <Button size="small" color="success" variant="contained" onClick={() => void runAction(alert.id, 'resolve')}>
                            Resolve
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}

              {alerts && alerts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <ApiFeedback loading={false} error="" empty emptyMessage="No active alerts recorded by the API." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {!alerts && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>
    </Stack>
  )
}

export default AlertsPage
