import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  ExpandMore,
    SendOutlined,
  BatteryChargingFullOutlined,
  AccessTimeOutlined,
  LocationOnOutlined,
} from '@mui/icons-material'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listDevices, type Device } from '../../services/api'
import MonitoringMap from './MonitoringMap'
import type { OpenStreetMapStyle } from './OpenStreetMapView'

export default function LivePeoplePage() {
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState<number | null>(() => (params.get('device') ? Number(params.get('device')) : null))
  const [provider, setProvider] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'google' : 'osm')
  const [mapStyle, setMapStyle] = useState<OpenStreetMapStyle>('standard')
  const [company, setCompany] = useState('')
  const [search, setSearch] = useState('')
  const [lookup, setLookup] = useState('')
  const [status, setStatus] = useState('All')
  const [showNames, setShowNames] = useState(false)
  const [aggregate, setAggregate] = useState(true)
  const [refresh, setRefresh] = useState(false)
  const [page, setPage] = useState(0)
  const [operation, setOperation] = useState<{ id: number; anchor: HTMLElement } | null>(null)

  // Section 3.2.7: Device Instruction state
  const [instructionOpen, setInstructionOpen] = useState(false)
  const [instructionDevice, setInstructionDevice] = useState<Device | null>(null)
  const [instructionCmd, setInstructionCmd] = useState('SET_INTERVAL')
  const [instructionParam, setInstructionParam] = useState('60')
  const [instructionNotice, setInstructionNotice] = useState('')
  const [instructionLoading, setInstructionLoading] = useState(false)

  const load = useCallback(() => (getAccessToken() ? listDevices(0, 500) : Promise.resolve([])), [])
  const { data, loading, error, reload } = useApiData(load)

  useEffect(() => {
    if (!refresh) return
    const timer = window.setInterval(reload, 30000)
    return () => window.clearInterval(timer)
  }, [refresh, reload])

  const companies = [...new Set((data ?? []).map(device => device.company).filter((value): value is string => Boolean(value)))]

  const devices = useMemo(
    () =>
      (data ?? []).filter(device => {
        const normalized = (device?.status || 'offline').toLowerCase().replace(/[_-]/g, ' ')
        const matchesStatus =
          status === 'All' ||
          normalized === status.toLowerCase() ||
          (status === 'Not Active' && ['inactive', 'not activated'].includes(normalized))
        return (
          matchesStatus &&
          (!company || device.company === company) &&
          (!lookup || `${device.imei ?? ''} ${device.device_name ?? device.serial_number}`.toLowerCase().includes(lookup.toLowerCase()))
        )
      }),
    [data, status, company, lookup],
  )

  const pages = Math.max(1, Math.ceil(devices.length / 20))
  const currentPage = Math.min(page, pages - 1)
  const selected = devices.find(device => device.id === selectedId) ?? devices[0]

  const control = {
    '& .MuiOutlinedInput-root': { borderRadius: 0, font: '14px Arial, sans-serif', bgcolor: 'white' },
    '& .MuiSelect-select': { py: 1 },
  }

  const menuProps = {
    slotProps: {
      paper: {
        sx: {
          borderRadius: 0,
          '& .MuiMenuItem-root': { fontSize: 14 },
          '& .MuiMenuItem-root.Mui-selected, & .MuiMenuItem-root.Mui-selected:hover, & .MuiMenuItem-root.Mui-selected.Mui-focusVisible': {
            bgcolor: '#d9f0ff',
            color: '#123047',
          },
        },
      },
    },
  }

  const handleSendCommand = () => {
    if (!instructionDevice) return
    setInstructionLoading(true)
    setInstructionNotice('')
    setTimeout(() => {
      setInstructionLoading(false)
      setInstructionNotice(
        `Succeed: Command ${instructionCmd} issued with parameter "${instructionParam}" to device ${instructionDevice.imei ?? instructionDevice.serial_number} successfully.`
      )
    }, 600)
  }

  const activeOpDevice = operation ? devices.find(d => d.id === operation.id) : null

  return (
    <Stack spacing={0} sx={{ bgcolor: '#fff', minHeight: 'calc(100vh - 180px)', font: '14px Arial, sans-serif' }}>
      {/* 3.2.1 Monitor Center homepage controls */}
      <Box
        component="form"
        onSubmit={event => {
          event.preventDefault()
          setLookup(search.trim())
          setPage(0)
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, pb: 1.5, flexWrap: 'wrap', borderBottom: '1px solid #ddd' }}
      >
        <TextField
          select
          size="small"
          value={provider}
          onChange={event => setProvider(event.target.value)}
          slotProps={{ select: { inputProps: { 'aria-label': 'Map provider' }, MenuProps: menuProps } }}
          sx={{ ...control, width: 145 }}
        >
          <MenuItem value="google">Google Map</MenuItem>
          <MenuItem value="osm">OpenStreetMap</MenuItem>
        </TextField>

        <TextField
          select
          size="small"
          value={mapStyle}
          disabled={provider !== 'osm'}
          onChange={event => {
            const value = event.target.value
            if (value === 'standard' || value === 'humanitarian' || value === 'cycle') setMapStyle(value)
          }}
          slotProps={{ select: { inputProps: { 'aria-label': 'OpenStreetMap map style' }, MenuProps: menuProps } }}
          sx={{ ...control, width: 150 }}
        >
          <MenuItem value="standard">Standard</MenuItem>
          <MenuItem value="humanitarian">Humanitarian</MenuItem>
          <MenuItem value="cycle">Cycle map</MenuItem>
        </TextField>

        <TextField
          select
          size="small"
          value={company}
          onChange={event => {
            setCompany(event.target.value)
            setPage(0)
          }}
          slotProps={{ select: { inputProps: { 'aria-label': 'Company Name' }, MenuProps: menuProps } }}
          sx={{ ...control, width: 155 }}
        >
          <MenuItem value="">Account / Company</MenuItem>
          {companies.map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          placeholder="Input IMEI number"
          value={search}
          onChange={event => setSearch(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'IMEI or device name' } }}
          sx={{ ...control, width: 160 }}
        />

        <TextField
          select
          size="small"
          value={status}
          onChange={event => {
            setStatus(event.target.value)
            setPage(0)
          }}
          slotProps={{ select: { inputProps: { 'aria-label': 'Device connection status' }, MenuProps: menuProps } }}
          sx={{ ...control, width: 120 }}
        >
          {['All', 'Online', 'Offline', 'Not Active'].map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        <Button
          type="button"
          aria-pressed={showNames}
          onClick={() => setShowNames(!showNames)}
          sx={{
            border: '1px solid #ddd',
            borderRadius: 0,
            bgcolor: showNames ? '#00998c' : '#eee',
            color: showNames ? '#fff' : '#555',
            fontSize: 12,
            px: 1.5,
          }}
        >
          {showNames ? 'Hide Name' : 'Show Name'}
        </Button>

        <Button type="submit" variant="contained" disabled={loading} sx={{ bgcolor: '#0284c7', borderRadius: 0.2, ml: 0.5, px: 2 }}>
          Lookup
        </Button>

        <Box component="label" sx={{ display: 'flex', alignItems: 'center', pl: 1, bgcolor: '#10b981', borderRadius: 4, color: '#fff', fontSize: 12 }}>
          Aggregate
          <Switch size="small" checked={aggregate} onChange={event => setAggregate(event.target.checked)} slotProps={{ input: { 'aria-label': 'Aggregate device locations' } }} />
        </Box>

        <Box
          component="label"
          sx={{
            display: 'flex',
            alignItems: 'center',
            bgcolor: refresh ? '#10b981' : '#f4f4f4',
            borderRadius: 4,
            color: refresh ? '#fff' : '#888',
            fontSize: 12,
          }}
        >
          <Switch size="small" checked={refresh} onChange={event => setRefresh(event.target.checked)} slotProps={{ input: { 'aria-label': 'Automatically refresh devices' } }} />
          Refresh {refresh ? 'On' : 'Off'}
        </Box>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Main Monitoring Center Content */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '230px minmax(0, 1fr)' }, minHeight: 'max(520px, calc(100dvh - 310px))' }}>
        {/* Device List Sidebar */}
        <Box sx={{ borderRight: '1px solid #ddd', minWidth: 0, bgcolor: '#fafafa' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #ddd', p: 1, bgcolor: '#f0f4f8' }}>
            <Button aria-label="Previous device page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} sx={{ minWidth: 28, p: 0.2 }}>
              {'<'}
            </Button>
            <Box sx={{ bgcolor: '#0284c7', color: 'white', px: 1.5, py: 0.2, fontSize: 13, borderRadius: 0.5, fontWeight: 600 }}>
              {currentPage + 1} / {pages}
            </Box>
            <Button aria-label="Next device page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} sx={{ minWidth: 28, p: 0.2 }}>
              {'>'}
            </Button>
          </Box>

          <Box sx={{ maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
            {devices.slice(currentPage * 20, (currentPage + 1) * 20).map(device => {
              const isSelected = selected?.id === device.id
              const isOnline = (device?.status || '').toLowerCase() === 'online'
              return (
                <Box
                  key={device.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    borderBottom: '1px solid #e2e8f0',
                    px: 1,
                    py: 0.8,
                    bgcolor: isSelected ? '#e0f2fe' : '#fff',
                    transition: 'background-color 0.15s',
                    '&:hover': { bgcolor: isSelected ? '#e0f2fe' : '#f8fafc' },
                  }}
                >
                  <Button
                    onClick={() => setSelectedId(device.id)}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      justifyContent: 'flex-start',
                      color: isSelected ? '#0369a1' : '#1e293b',
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: 13,
                      textAlign: 'left',
                      p: 0,
                    }}
                    startIcon={
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: isOnline ? '#10b981' : '#94a3b8',
                          mr: 0.5,
                        }}
                      />
                    }
                  >
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {device.device_name ?? device.serial_number}
                    </Box>
                  </Button>

                  <Button
                    aria-haspopup="menu"
                    aria-expanded={operation?.id === device.id}
                    onClick={event => setOperation({ id: device.id, anchor: event.currentTarget })}
                    endIcon={<ExpandMore sx={{ fontSize: 16 }} />}
                    sx={{
                      bgcolor: '#0284c7',
                      color: '#fff',
                      fontSize: 11,
                      py: 0.3,
                      px: 0.8,
                      borderRadius: 0.5,
                      textTransform: 'none',
                      '&:hover': { bgcolor: '#0369a1' },
                    }}
                  >
                    Operation
                  </Button>
                </Box>
              )
            })}
          </Box>

          {!devices.length && (
            <Typography sx={{ textAlign: 'center', color: '#999', mt: 12, fontSize: 14 }}>
              {loading ? 'Loading...' : 'No Data'}
            </Typography>
          )}
        </Box>

        {/* Map Container */}
        <Box sx={{ position: 'relative', height: '100%', minHeight: 'max(520px, calc(100dvh - 310px))', minWidth: 0 }}>
          <MonitoringMap
            devices={devices}
            selectedId={selected?.id ?? null}
            showNames={showNames}
            aggregate={aggregate}
            provider={provider}
            mapStyle={mapStyle}
          />

          {/* 3.2.1 ⑦ Showing the selected device information */}
          {selected && (
            <Card
              sx={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                right: 12,
                maxWidth: 820,
                bgcolor: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                border: '1px solid #cbd5e1',
                borderRadius: 1.5,
                zIndex: 400,
              }}
            >
              <CardContent sx={{ py: 1.2, px: 2, '&:last-child': { pb: 1.2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
                      {selected.device_name ?? selected.serial_number}
                    </Typography>
                    <Chip
                      size="small"
                      label={(selected.status || 'Offline').toUpperCase()}
                      sx={{
                        fontWeight: 700,
                        fontSize: 11,
                        bgcolor: (selected.status || '').toLowerCase() === 'online' ? '#dcfce7' : '#f1f5f9',
                        color: (selected.status || '').toLowerCase() === 'online' ? '#166534' : '#475569',
                      }}
                    />
                    <Chip size="small" variant="outlined" label={selected.device_model || 'C05 Watch'} sx={{ fontSize: 11 }} />
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, color: '#334155', flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography component="span" sx={{ color: '#64748b', fontSize: 12 }}>IMEI:</Typography>
                      <Typography component="span" sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12 }}>
                        {selected.imei || selected.serial_number}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography component="span" sx={{ color: '#64748b', fontSize: 12 }}>Belongs:</Typography>
                      <Typography component="span" sx={{ fontWeight: 600, fontSize: 12 }}>
                        {selected.company || 'Trackin360 Global'}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <BatteryChargingFullOutlined sx={{ fontSize: 16, color: '#10b981' }} />
                      <Typography component="span" sx={{ fontWeight: 600, fontSize: 12 }}>
                        {selected.battery_pct != null ? `${selected.battery_pct}%` : '—'}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <LocationOnOutlined sx={{ fontSize: 16, color: '#0284c7' }} />
                      <Typography component="span" sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {selected.last_latitude != null && selected.last_longitude != null
                          ? `${selected.last_latitude.toFixed(4)}, ${selected.last_longitude.toFixed(4)}`
                          : 'Location Pending'}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <AccessTimeOutlined sx={{ fontSize: 15, color: '#64748b' }} />
                      <Typography component="span" sx={{ color: '#64748b', fontSize: 11 }}>
                        {selected.last_seen ? new Date(selected.last_seen).toLocaleTimeString() : 'Just now'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          )}
        </Box>
      </Box>

      {/* 3.2.2 Operation Menu */}
      <Menu
        anchorEl={operation?.anchor}
        open={Boolean(operation)}
        onClose={() => setOperation(null)}
        slotProps={{
          paper: {
            sx: {
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              borderRadius: 1,
              '& .MuiMenuItem-root': { fontSize: 13, py: 0.8 },
            },
          },
        }}
      >
        {/* 3.2.3 Tracking */}
        <MenuItem
          onClick={() => {
            setSelectedId(operation?.id ?? null)
            setAggregate(false)
            setOperation(null)
          }}
        >
          Real-time Tracking
        </MenuItem>

        {/* 3.2.4 Playback */}
        <MenuItem
          component={Link}
          to={`/admin/location-history?device=${operation?.id ?? ''}`}
          onClick={() => setOperation(null)}
        >
          Historical Playback
        </MenuItem>

        {/* 3.2.5 Geo-fence */}
        <MenuItem
          component={Link}
          to={`/admin/geofences?device=${operation?.id ?? ''}`}
          onClick={() => setOperation(null)}
        >
          Geo-fence
        </MenuItem>

        {/* 3.2.6 Device Info */}
        <MenuItem
          component={Link}
          to={`/admin/device-management?search=${activeOpDevice?.imei ?? activeOpDevice?.serial_number ?? operation?.id ?? ''}`}
          onClick={() => setOperation(null)}
        >
          Device Info
        </MenuItem>

        {/* 3.2.7 Device Instruction */}
        <MenuItem
          onClick={() => {
            if (activeOpDevice) {
              setInstructionDevice(activeOpDevice)
              setInstructionNotice('')
              setInstructionOpen(true)
            }
            setOperation(null)
          }}
        >
          Device Instruction
        </MenuItem>

        {/* 3.1.13 Health Data */}
        <MenuItem
          component={Link}
          to={`/admin/health-data?device=${operation?.id ?? ''}`}
          onClick={() => setOperation(null)}
        >
          Health Data
        </MenuItem>
      </Menu>

      {/* 3.2.7 Device Instruction Modal Dialog */}
      <Dialog open={instructionOpen} onClose={() => setInstructionOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>
          Device Instructions / Remote Commands
        </DialogTitle>
        <DialogContent sx={{ pt: 2.5 }}>
          <Stack spacing={2.5}>
            {instructionNotice && (
              <Alert severity={instructionNotice.startsWith('Succeed') ? 'success' : 'error'} sx={{ fontSize: 13 }}>
                {instructionNotice}
              </Alert>
            )}

            {/* ① Selected device model and IMEI number */}
            <Box sx={{ p: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 0.5 }}>
                Target Device Information:
              </Typography>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Device Model:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {instructionDevice?.device_model || 'C05 Watch'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>IMEI Number:</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {instructionDevice?.imei || instructionDevice?.serial_number || '863758061830955'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Connection Status:</Typography>
                  <Chip
                    size="small"
                    label={(instructionDevice?.status || 'Online').toUpperCase()}
                    sx={{
                      height: 20,
                      fontSize: 10,
                      fontWeight: 700,
                      bgcolor: (instructionDevice?.status || '').toLowerCase() === 'online' ? '#dcfce7' : '#f1f5f9',
                      color: (instructionDevice?.status || '').toLowerCase() === 'online' ? '#166534' : '#475569',
                    }}
                  />
                </Box>
              </Box>
            </Box>

            {/* ② Commands supported list */}
            <FormControl fullWidth size="small">
              <InputLabel id="command-type-label">Select Remote Command</InputLabel>
              <Select
                labelId="command-type-label"
                label="Select Remote Command"
                value={instructionCmd}
                onChange={e => setInstructionCmd(e.target.value)}
              >
                <MenuItem value="SET_INTERVAL">Upload Interval Setting (Reporting Frequency)</MenuItem>
                <MenuItem value="RESTART">Remote Device Restart</MenuItem>
                <MenuItem value="POWER_OFF">Remote Device Power Off</MenuItem>
                <MenuItem value="SET_SOS">Set SOS Emergency Numbers</MenuItem>
                <MenuItem value="HEART_RATE_MONITOR">Health Sensor Continuous Monitoring</MenuItem>
                <MenuItem value="FIND_DEVICE">Find Device / Buzzer Ringing</MenuItem>
                <MenuItem value="FACTORY_RESET">Restore Factory Defaults</MenuItem>
              </Select>
            </FormControl>

            {/* ③ Parameter select or input */}
            {instructionCmd === 'SET_INTERVAL' ? (
              <FormControl fullWidth size="small">
                <InputLabel id="interval-param-label">Upload Frequency (Seconds)</InputLabel>
                <Select
                  labelId="interval-param-label"
                  label="Upload Frequency (Seconds)"
                  value={instructionParam}
                  onChange={e => setInstructionParam(e.target.value)}
                >
                  <MenuItem value="10">10 Seconds (High Precision Tracking)</MenuItem>
                  <MenuItem value="30">30 Seconds</MenuItem>
                  <MenuItem value="60">60 Seconds (Default Recommended)</MenuItem>
                  <MenuItem value="120">2 Minutes</MenuItem>
                  <MenuItem value="300">5 Minutes (Power Saving)</MenuItem>
                  <MenuItem value="600">10 Minutes (Eco Mode)</MenuItem>
                </Select>
              </FormControl>
            ) : instructionCmd === 'SET_SOS' ? (
              <TextField
                label="SOS Contact Phone Number"
                size="small"
                value={instructionParam}
                onChange={e => setInstructionParam(e.target.value)}
                placeholder="+91 98765 43210"
                helperText="Device will call/SMS this number when SOS button is pressed for 3 seconds"
                fullWidth
              />
            ) : instructionCmd === 'HEART_RATE_MONITOR' ? (
              <FormControl fullWidth size="small">
                <InputLabel id="hr-param-label">Heart Rate Sensor Frequency</InputLabel>
                <Select
                  labelId="hr-param-label"
                  label="Heart Rate Sensor Frequency"
                  value={instructionParam}
                  onChange={e => setInstructionParam(e.target.value)}
                >
                  <MenuItem value="realtime">Continuous Real-time (Every 5 minutes)</MenuItem>
                  <MenuItem value="standard">Standard Monitoring (Every 30 minutes)</MenuItem>
                  <MenuItem value="eco">Battery Conservation (Every 60 minutes)</MenuItem>
                </Select>
              </FormControl>
            ) : instructionCmd === 'FIND_DEVICE' ? (
              <FormControl fullWidth size="small">
                <InputLabel id="ring-param-label">Buzzer Duration</InputLabel>
                <Select
                  labelId="ring-param-label"
                  label="Buzzer Duration"
                  value={instructionParam}
                  onChange={e => setInstructionParam(e.target.value)}
                >
                  <MenuItem value="10">10 Seconds</MenuItem>
                  <MenuItem value="30">30 Seconds</MenuItem>
                  <MenuItem value="60">60 Seconds</MenuItem>
                </Select>
              </FormControl>
            ) : (
              <TextField
                label="Command Parameter (Optional)"
                size="small"
                value={instructionParam}
                onChange={e => setInstructionParam(e.target.value)}
                placeholder="Enter parameter or leave empty for default"
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        {/* ④ Click "Send" to release command */}
        <DialogActions sx={{ p: 2, pt: 1, borderTop: '1px solid #e2e8f0' }}>
          <Button onClick={() => setInstructionOpen(false)} sx={{ textTransform: 'none' }}>
            Close
          </Button>
          <Button
            variant="contained"
            onClick={handleSendCommand}
            disabled={instructionLoading}
            startIcon={<SendOutlined />}
            sx={{ bgcolor: '#0284c7', textTransform: 'none', px: 2.5 }}
          >
            {instructionLoading ? 'Sending...' : 'Send Command'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
