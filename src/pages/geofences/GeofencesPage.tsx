import { useCallback, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { AddOutlined, DeleteOutlined, InfoOutlined } from '@mui/icons-material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { createGeofence, deleteGeofence, listDevices, listGeofences, updateGeofence, type Device, type FenceType } from '../../services/api'
import GeofenceMap from './GeofenceMap'

function GeofencesPage() {
  const [params] = useSearchParams()
  const deviceParam = params.get('device')
  const requestedDeviceId = deviceParam ? Number(deviceParam) : null
  const validDeviceId = requestedDeviceId !== null && Number.isInteger(requestedDeviceId) && requestedDeviceId > 0
  
  // Section 3.2.5 Electronic Fence State
  const [dialogOpen, setDialogOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [name, setName] = useState('')
  const [remark, setRemark] = useState('')
  const [alarmType, setAlarmType] = useState<'only_enter' | 'only_out' | 'in_and_out'>('only_out')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [radius, setRadius] = useState('200')

  const loadGeofences = useCallback(() => listGeofences(0, 500), [])
  const loadDevices = useCallback(
    () => (deviceParam && validDeviceId ? listDevices(0, 500) : Promise.resolve([] as Device[])),
    [deviceParam, validDeviceId],
  )
  const { data: geofences, loading, error, reload } = useApiData(loadGeofences)
  const { data: devices, loading: devicesLoading, error: devicesError } = useApiData(loadDevices)
  const device = validDeviceId ? devices?.find(item => item.id === requestedDeviceId) ?? null : null

  const openCreateDialog = () => {
    setName('')
    setRemark('')
    setAlarmType('only_out')
    setLatitude(device?.last_latitude == null ? '31.2304' : String(device.last_latitude))
    setLongitude(device?.last_longitude == null ? '121.4737' : String(device.last_longitude))
    setRadius('200')
    setDialogOpen(true)
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError('')
    try {
      const fence_type: FenceType = alarmType === 'only_enter' ? 'inclusion' : 'exclusion'
      await createGeofence({
        name: name.trim() + (remark ? ` (${remark.trim()})` : ''),
        fence_type,
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius_m: Number(radius),
      })
      setDialogOpen(false)
      setName('')
      setRemark('')
      setLatitude('')
      setLongitude('')
      setRadius('200')
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to create geofence.')
    }
  }

  const handleToggle = async (id: number, isActive: boolean) => {
    setActionError('')
    try {
      await updateGeofence(id, { is_active: !isActive })
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update geofence.')
    }
  }

  const handleDelete = async (id: number) => {
    setActionError('')
    try {
      await deleteGeofence(id)
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to delete geofence.')
    }
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {deviceParam ? 'Device Electronic Fence' : 'Electronic Fence Management'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {deviceParam ? 'Real-time device position and electronic boundary zones' : 'Configure circular security perimeters and boundary alarms'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {deviceParam && (
            <Button component={Link} to={`/admin/monitoring-center?device=${encodeURIComponent(deviceParam)}`} sx={{ textTransform: 'none' }}>
              Back to Monitoring
            </Button>
          )}
          {/* ① Click "Electronic fence" */}
          <Button
            variant="contained"
            onClick={openCreateDialog}
            startIcon={<AddOutlined />}
            sx={{ bgcolor: '#0284c7', textTransform: 'none', fontWeight: 600, px: 2 }}
          >
            Electronic fence
          </Button>
        </Stack>
      </Box>

      {/* Note banner: 3.2.5 Note */}
      <Alert severity="info" icon={<InfoOutlined />} sx={{ fontSize: 13 }}>
        <strong>Note:</strong> Setting on web platform only supports setting <strong>circle geofence</strong>; setting on mobile application supports polygonal geofence.
      </Alert>

      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}
      {deviceParam && !validDeviceId && <Alert severity="error">The device identifier in this link is invalid.</Alert>}
      {deviceParam && validDeviceId && devicesError && <ApiFeedback loading={false} error={devicesError} empty={false} emptyMessage="" />}
      {deviceParam && validDeviceId && devicesLoading && !devices && <ApiFeedback loading error="" empty={false} emptyMessage="" />}
      {deviceParam && validDeviceId && devices && !device && <Alert severity="warning">This device is not available in the device list.</Alert>}

      {deviceParam && validDeviceId && device && (
        <>
          <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{device.device_name ?? device.serial_number}</Typography>
                <Typography variant="body2" color="text.secondary">
                  IMEI: {device.imei ?? '—'} · Current location:{' '}
                  {device.last_latitude != null && device.last_longitude != null
                    ? `${device.last_latitude.toFixed(5)}, ${device.last_longitude.toFixed(5)}`
                    : 'Not available'}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
          {geofences && (
            <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent>
                <GeofenceMap device={device} geofences={geofences} />
                <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">Blue marker: selected device</Typography>
                  <Typography variant="caption" color="success.main">Green circle: only enter / inclusion</Typography>
                  <Typography variant="caption" color="error.main">Red circle: only out / exclusion</Typography>
                  <Typography variant="caption" color="text.secondary">Gray circle: disabled</Typography>
                </Stack>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ② Showing exist geofence, you can delete */}
      <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <CardContent sx={{ overflowX: 'auto', p: 0 }}>
          <Table sx={{ minWidth: 850 }}>
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Geofence Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Alarm Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Radius (m)</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Center Latitude</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Center Longitude</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Operation</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {geofences?.map((geofence) => {
                const isOnlyEnter = geofence.fence_type === 'inclusion'
                return (
                  <TableRow key={geofence.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{geofence.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={isOnlyEnter ? 'Only Enter' : 'Only Out'}
                        sx={{
                          fontWeight: 600,
                          fontSize: 11,
                          bgcolor: isOnlyEnter ? '#dcfce7' : '#fee2e2',
                          color: isOnlyEnter ? '#166534' : '#991b1b',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{geofence.radius_m} m</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{geofence.latitude.toFixed(5)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{geofence.longitude.toFixed(5)}</TableCell>
                    <TableCell>
                      <Chip
                        label={geofence.is_active ? 'Active' : 'Disabled'}
                        size="small"
                        color={geofence.is_active ? 'success' : 'default'}
                        sx={{ fontWeight: 600, fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => void handleToggle(geofence.id, geofence.is_active)}
                          sx={{ textTransform: 'none', fontSize: 12 }}
                        >
                          {geofence.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteOutlined sx={{ fontSize: 15 }} />}
                          onClick={() => void handleDelete(geofence.id)}
                          sx={{ textTransform: 'none', fontSize: 12 }}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
              {geofences && geofences.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <ApiFeedback loading={false} error="" empty emptyMessage="No geofences found. Click 'Electronic fence' above to create one." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {!geofences && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>

      {/* 3.2.5 Electronic Fence Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={handleCreate}>
          <DialogTitle sx={{ fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>
            Set Electronic Fence
          </DialogTitle>
          <DialogContent sx={{ pt: 2.5 }}>
            <Stack spacing={2.5}>
              <Alert severity="info" sx={{ fontSize: 12 }}>
                Web platform supports circle electronic fences. Specify the center coordinates and fence radius.
              </Alert>

              {/* ③ Input the Geofence name */}
              <TextField
                label="Geofence Name"
                placeholder="e.g. Custody Safe Zone / Hospital Perimeter"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                size="small"
                fullWidth
              />

              {/* ④ Input the remark if need */}
              <TextField
                label="Remark (Optional)"
                placeholder="Enter remarks or security instructions"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                size="small"
                fullWidth
              />

              {/* ⑤ Select the geofence alarm type */}
              <FormControl fullWidth size="small">
                <InputLabel id="alarm-type-label">Geofence Alarm Type</InputLabel>
                <Select
                  labelId="alarm-type-label"
                  label="Geofence Alarm Type"
                  value={alarmType}
                  onChange={(event) => {
                    const val = event.target.value as 'only_enter' | 'only_out' | 'in_and_out'
                    setAlarmType(val)
                  }}
                >
                  <MenuItem value="only_enter">Only Enter (Trigger alert when entering area)</MenuItem>
                  <MenuItem value="only_out">Only Out (Trigger alert when leaving area)</MenuItem>
                  <MenuItem value="in_and_out">In and Out (Trigger alert on entry and exit)</MenuItem>
                </Select>
              </FormControl>

              {/* ① Set the fence radius */}
              <TextField
                label="Fence Radius (meters)"
                type="number"
                value={radius}
                onChange={(event) => setRadius(event.target.value)}
                required
                helperText="Radius of the circular perimeter in meters"
                size="small"
                slotProps={{ htmlInput: { step: '10', min: '10', max: '50000' } }}
                fullWidth
              />

              <Stack direction="row" spacing={2}>
                <TextField
                  label="Center Latitude"
                  type="number"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  required
                  size="small"
                  slotProps={{ htmlInput: { step: 'any', min: -90, max: 90 } }}
                  fullWidth
                />
                <TextField
                  label="Center Longitude"
                  type="number"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  required
                  size="small"
                  slotProps={{ htmlInput: { step: 'any', min: -180, max: 180 } }}
                  fullWidth
                />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 1, borderTop: '1px solid #e2e8f0' }}>
            <Button onClick={() => setDialogOpen(false)} sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" sx={{ bgcolor: '#0284c7', textTransform: 'none', px: 2.5 }}>
              Confirm & Save
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  )
}

export default GeofencesPage
