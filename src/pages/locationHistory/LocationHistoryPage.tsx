import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Card, CardContent, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { listDevices, listLocationHistory } from '../../services/api'

function LocationHistoryPage() {
  const [params] = useSearchParams()
  const [deviceId, setDeviceId] = useState(() => params.get('device') ?? '')
  const loadDevices = useCallback(() => listDevices(0, 500), [])
  const { data: devices, loading: devicesLoading, error: devicesError } = useApiData(loadDevices)

  const selectedDeviceId = deviceId || (devices?.length ? String(devices[0].id) : '')

  const loadHistory = useCallback(
    () => selectedDeviceId ? listLocationHistory(Number(selectedDeviceId), 500) : Promise.resolve([]),
    [selectedDeviceId],
  )
  const { data: locations, loading, error } = useApiData(loadHistory)

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Location History</Typography>
          <Typography variant="body2" color="text.secondary">Recorded coordinates returned by the API</Typography>
        </Box>
        <TextField
          select
          size="small"
          label="Device"
          value={selectedDeviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          sx={{ minWidth: 240 }}
          disabled={!devices?.length}
        >
          {devices?.map((device) => (
            <MenuItem key={device.id} value={String(device.id)}>{device.serial_number}</MenuItem>
          ))}
        </TextField>
      </Box>
      {devicesError && <ApiFeedback loading={false} error={devicesError} empty={false} emptyMessage="" />}
      {devicesLoading && !devices && <ApiFeedback loading error="" empty={false} emptyMessage="" />}
      {devices && devices.length === 0 && <ApiFeedback loading={false} error="" empty emptyMessage="No devices are available to query for location history." />}
      {error && <ApiFeedback loading={false} error={error} empty={false} emptyMessage="" />}

      <Card>
        <CardContent sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>Recorded At</TableCell>
                <TableCell>Latitude</TableCell>
                <TableCell>Longitude</TableCell>
                <TableCell>Accuracy</TableCell>
                <TableCell>Speed</TableCell>
                <TableCell>Heading</TableCell>
                <TableCell>Battery</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {locations?.map((location) => (
                <TableRow key={location.id} hover>
                  <TableCell>{new Date(location.recorded_at).toLocaleString()}</TableCell>
                  <TableCell>{location.latitude}</TableCell>
                  <TableCell>{location.longitude}</TableCell>
                  <TableCell>{location.accuracy_m == null ? '—' : `${location.accuracy_m} m`}</TableCell>
                  <TableCell>{location.speed_kmh == null ? '—' : `${location.speed_kmh} km/h`}</TableCell>
                  <TableCell>{location.heading == null ? '—' : `${location.heading}°`}</TableCell>
                  <TableCell>{location.battery_pct == null ? '—' : `${location.battery_pct}%`}</TableCell>
                </TableRow>
              ))}
              {locations && locations.length === 0 && selectedDeviceId && (
                <TableRow><TableCell colSpan={7}><ApiFeedback loading={false} error="" empty emptyMessage="No location history returned for this device." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {selectedDeviceId && !locations && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>
    </Stack>
  )
}

export default LocationHistoryPage
