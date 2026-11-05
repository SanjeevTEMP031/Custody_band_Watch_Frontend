import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listDevices, type Device } from '../../services/api'
import DeviceTable from './DeviceTable'
import HealthDeviceDetail from './HealthDeviceDetail'

const metrics = ['Heart rate', 'Blood pressure', 'Temperature', 'Step counter', 'Sleep', 'Blood Oxygen']
const metricValue = (d: Device, metric: string) => [d.heart_rate, d.blood_pressure, d.temperature, d.step_counter, d.sleep, d.blood_oxygen][metrics.indexOf(metric)] ?? '-'
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

export default function HealthDataPage({ geofenceView = false }: { geofenceView?: boolean }) {
  const [params] = useSearchParams()
  const loadDevices = useCallback(() => getAccessToken() ? listDevices(0, 500) : Promise.resolve([] as Device[]), [])
  const { data, loading, error, reload } = useApiData(loadDevices)
  const [query, setQuery] = useState(''), [status, setStatus] = useState('All')
  const [filters, setFilters] = useState({ query: '', status: 'All' })
  const [metric, setMetric] = useState('Heart rate')
  const [start, setStart] = useState(() => localDate(new Date(new Date().setHours(0, 0, 0, 0))))
  const [end, setEnd] = useState(() => localDate(new Date()))
  const [page, setPage] = useState(1), [size, setSize] = useState(20), [jump, setJump] = useState('1')
  const [detail, setDetail] = useState<Device | null>(null), [validation, setValidation] = useState('')
  const rows = (data ?? []).filter(d => (!params.get('device') || String(d.id) === params.get('device')) && (!filters.query || [d.imei, d.device_sim, d.device_name, d.serial_number].some(value => value?.toLowerCase().includes(filters.query))) && (filters.status === 'All' || (filters.status === 'Not Active' ? ['inactive', 'not_active'].includes((d?.status || 'offline').toLowerCase()) : (d?.status || 'offline').toLowerCase() === filters.status.toLowerCase())))
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages)
  const field = { width: 190, '& .MuiOutlinedInput-root': { borderRadius: 0, bgcolor: '#fff', font: '14px Arial, sans-serif' } }
  const lookup = () => {
    if (!start || !end || start > end) { setValidation('Choose a valid start and end time.'); return }
    setValidation(''); setFilters({ query: query.trim().toLowerCase(), status }); setPage(1)
  }
  const exportHealth = async () => {
    const { utils, writeFile } = await import('xlsx')
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['Imei', 'Device Name', 'Company', 'Device SIM', 'Device Model', 'Last communication time', 'Battery', ...metrics],
      ...rows.map(d => [d.imei ?? '', d.device_name ?? d.serial_number, d.company ?? '', d.device_sim ?? '', d.device_model ?? '', d.last_seen ?? '', d.battery_pct ?? '', ...metrics.map(m => metricValue(d, m))]),
    ]), 'Health Data')
    writeFile(workbook, 'Health Data.xls', { bookType: 'biff8' })
  }
  if (detail) return <HealthDeviceDetail device={detail} onBack={() => setDetail(null)} />
  return <Stack spacing={2} sx={{ bgcolor: '#fff', p: 1.5 }}>
    {!geofenceView && <Typography sx={{ color: '#00998c', fontWeight: 600 }}>Health Data</Typography>}
    <Box component="form" onSubmit={event => { event.preventDefault(); lookup() }} sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
      <TextField size="small" placeholder="IMEI/SIM" value={query} onChange={e => setQuery(e.target.value)} sx={field} slotProps={{ htmlInput: { 'aria-label': 'IMEI or SIM' } }} />
      <TextField select size="small" value={status} onChange={e => setStatus(e.target.value)} sx={field} slotProps={{ select: { inputProps: { 'aria-label': 'Device status' } } }}>{['All', 'Online', 'Offline', 'Not Active'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
      <Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3 }}>Lookup</Button>
      <TextField select size="small" value={metric} onChange={e => setMetric(e.target.value)} sx={field} slotProps={{ select: { inputProps: { 'aria-label': 'Health measurement' } } }}>{metrics.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
      <TextField type="datetime-local" size="small" value={start} onChange={e => setStart(e.target.value)} sx={{ ...field, width: 230 }} slotProps={{ htmlInput: { 'aria-label': 'Health start time' } }} />
      <TextField type="datetime-local" size="small" value={end} onChange={e => setEnd(e.target.value)} sx={{ ...field, width: 230 }} slotProps={{ htmlInput: { 'aria-label': 'Health end time', min: start } }} />
    </Box>
    <Box><Button onClick={() => void exportHealth()} variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3 }}>Export Health Data</Button></Box>
    {(error || validation) && <Alert severity="error">{validation || error}</Alert>}
    {loading && <Typography role="status">Loading devices...</Typography>}
    <DeviceTable devices={rows.slice((current - 1) * size, current * size)} health onHealth={setDetail} onAssign={() => {}} onUnassign={() => {}} />
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', border: '1px solid #e3e3e3', p: 1 }}>
      <Button disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</Button><Typography>{current} / {pages}</Typography><Button disabled={current === pages} onClick={() => setPage(current + 1)}>Next</Button>
      <Button onClick={reload}>Refresh</Button><Typography sx={{ fontSize: 13 }}>Sum {rows.length} Rows</Typography>
      <TextField select size="small" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}>{[20, 50, 100].map(value => <MenuItem key={value} value={value}>{value} Rows/Page</MenuItem>)}</TextField>
      <TextField size="small" type="number" value={jump} onChange={e => setJump(e.target.value)} sx={{ width: 65 }} slotProps={{ htmlInput: { min: 1, max: pages, 'aria-label': 'Page number' } }} /><Button onClick={() => { const value = Number(jump); if (Number.isInteger(value) && value >= 1 && value <= pages) setPage(value) }}>OK</Button>
    </Box>
  </Stack>
}
