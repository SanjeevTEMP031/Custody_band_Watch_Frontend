import { useCallback, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { acknowledgeAlert, listAlerts, listDevices, resolveAlert } from '../../services/api'

function NotificationsPage() {
  const [actionError, setActionError] = useState('')
  const loadMessages = useCallback(async () => {
    const [alerts, devices] = await Promise.all([listAlerts(0, 500), listDevices(0, 500)])
    return { alerts, devices }
  }, [])
  const { data, loading, error, reload } = useApiData(loadMessages)

  const handleAction = async (alertId: number, action: 'acknowledge' | 'resolve') => {
    setActionError('')
    try {
      if (action === 'acknowledge') await acknowledgeAlert(alertId)
      else await resolveAlert(alertId)
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update this alert.')
    }
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Messages</Typography>
        <Typography variant="body2" color="text.secondary">Device alerts returned by the API</Typography>
      </Box>
      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}
      <Card>
        <CardContent sx={{ p: 0, overflowX: 'auto' }}>
          <Table sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell>Device Name</TableCell>
                <TableCell>Exception Type</TableCell>
                <TableCell>IMEI</TableCell>
                <TableCell>Exception Time</TableCell>
                <TableCell>Operation</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.alerts.map((alert) => {
                const device = data.devices.find((item) => item.id === alert.device_id)
                return (
                  <TableRow key={alert.id} hover>
                    <TableCell>{device?.serial_number ?? (alert.device_id === null ? '—' : `Device ${alert.device_id}`)}</TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2">{alert.message}</Typography>
                        <Chip label={`${alert.type} · ${alert.severity}`} size="small" variant="outlined" sx={{ width: 'fit-content' }} />
                      </Stack>
                    </TableCell>
                    <TableCell>{device?.imei ?? '—'}</TableCell>
                    <TableCell>{new Date(alert.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {(alert.status || '').toLowerCase() !== 'acknowledged' && (alert.status || '').toLowerCase() !== 'resolved' && (
                          <Button size="small" color="error" variant="contained" onClick={() => void handleAction(alert.id, 'acknowledge')}>
                            Acknowledge
                          </Button>
                        )}
                        {(alert.status || '').toLowerCase() !== 'resolved' && (
                          <Button size="small" color="warning" variant="contained" onClick={() => void handleAction(alert.id, 'resolve')}>
                            Resolve
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
              {data && data.alerts.length === 0 && (
                <TableRow><TableCell colSpan={5}><ApiFeedback loading={false} error="" empty emptyMessage="No device alerts returned by the API." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {!data && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>
    </Stack>
  )
}

export default NotificationsPage
