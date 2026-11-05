import { useCallback, useMemo, useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { RefreshOutlined } from '@mui/icons-material'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listAlerts, listDevices } from '../../services/api'
import StatisticsSectionNav from '../../components/layout/StatisticsSectionNav'

// 4.1 ③ Select the alarm type: supports All, Offline, SOS alarm, Geofence, Vibration alarm, Sedentary Reminder, fall in alarm, low battery alarm
const alarmTypes = [
  'All',
  'Offline',
  'SOS Alarm',
  'Geofence',
  'Vibration Alarm',
  'A Sedentary Reminder',
  'Fall in the alarm',
  'Low Battery Alarm',
]

const dateKey = (value: string | Date) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}

const displayTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }) : '-'

const normalize = (value: string) => value.toLowerCase().replace(/[_-]/g, ' ')

const matchesType = (type: string, message: string, selected: string) => {
  if (selected === 'All') return true
  const value = normalize(`${type} ${message}`)
  const keywords: Record<string, string[]> = {
    Offline: ['offline'],
    'SOS Alarm': ['sos', 'emergency'],
    Geofence: ['geofence', 'fence'],
    'Vibration Alarm': ['vibration'],
    'A Sedentary Reminder': ['sedentary'],
    'Fall in the alarm': ['fall'],
    'Low Battery Alarm': ['low battery', 'battery low'],
  }
  return keywords[selected]?.some(keyword => value.includes(keyword)) ?? false
}

export default function AlarmStatisticsPage() {
  const today = dateKey(new Date())
  // 4.1 ① Select time period
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)

  // 4.1 ② Select the sub-distributor or end-user under management
  const [account, setAccount] = useState('')
  const [scope, setScope] = useState('Include subcompany')

  // 4.1 ③ Select the alarm type
  const [type, setType] = useState('All')

  // 4.1 ④ Input IMEI number
  const [imei, setImei] = useState('')

  // Applied filters on Lookup
  const [filters, setFilters] = useState({
    start: today,
    end: today,
    account: '',
    scope: 'Include subcompany',
    type: 'All',
    imei: '',
  })

  const [validationError, setValidationError] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(12)

  const load = useCallback(async () => {
    if (!getAccessToken()) return { alerts: [], devices: [] }
    const [alerts, devices] = await Promise.all([listAlerts(0, 500), listDevices(0, 500)])
    return { alerts, devices }
  }, [])
  const { data, loading, error, reload } = useApiData(load)

  // Extract distinct sub-distributor / end-user accounts from device inventory
  const accounts = useMemo(() => {
    const list = (data?.devices ?? []).map(d => d.company).filter((c): c is string => Boolean(c))
    return [...new Set(list)]
  }, [data])

  // 4.1 ⑥ Showing up all the alarms as selected
  const rows = useMemo(() => {
    const devicesMap = new Map((data?.devices ?? []).map(device => [device.id, device]))
    return (data?.alerts ?? [])
      .map(alert => ({
        alert,
        device: alert.device_id == null ? undefined : devicesMap.get(alert.device_id),
      }))
      .filter(({ alert, device }) => {
        const day = dateKey(alert.created_at)
        const matchesDate = day >= filters.start && day <= filters.end
        const matchesAlarmType = matchesType(alert.type, alert.message, filters.type)
        const deviceImei = device?.imei ?? alert.imei ?? ''
        const matchesImei = !filters.imei || deviceImei.toLowerCase().includes(filters.imei.toLowerCase())
        const companyName = device?.company ?? (alert as any).company ?? ''
        const matchesAccount = !filters.account || companyName === filters.account
        const matchesScope = filters.scope === 'Include subcompany' || alert.is_subcompany !== true
        return matchesDate && matchesAlarmType && matchesImei && matchesAccount && matchesScope
      })
      .sort((a, b) => new Date(b.alert.created_at).getTime() - new Date(a.alert.created_at).getTime())
  }, [data, filters])

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pages - 1)

  // 4.1 ⑤ Click "Lookup"
  const handleLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!start || !end || start > end) {
      setValidationError('Choose an end date on or after the start date.')
      return
    }
    setValidationError('')
    setFilters({
      start,
      end,
      account,
      scope,
      type,
      imei: imei.trim(),
    })
    setPage(0)
    reload()
  }

  const field = {
    minWidth: 160,
    flex: '1 1 160px',
    '& .MuiOutlinedInput-root': { borderRadius: 0, bgcolor: '#fff', font: '14px Arial, sans-serif' },
  }

  const menuProps = {
    slotProps: {
      paper: {
        sx: {
          borderRadius: 0,
          '& .MuiMenuItem-root': { font: '14px Arial, sans-serif', minHeight: 36 },
          '& .MuiMenuItem-root.Mui-selected, & .MuiMenuItem-root.Mui-selected:hover, & .MuiMenuItem-root.Mui-selected.Mui-focusVisible': {
            bgcolor: '#d9f0ff',
            color: '#123047',
          },
        },
      },
    },
  }

  const cell = {
    border: '1px solid #e3e3e3',
    height: 39,
    px: 2,
    py: 1,
    color: '#475569',
    font: '14px Arial, sans-serif',
    whiteSpace: 'nowrap',
  }

  return (
    <Stack spacing={0} sx={{ bgcolor: '#fff', minHeight: 'calc(100vh - 180px)', minWidth: 0, p: 2 }}>
      {/* Statistics Section Tabs */}
      <StatisticsSectionNav />

      {/* 4.1 Alarm statistics Header & Filter Controls */}
      <Box sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
          Alarm Statistics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Analyze security alarms, fall detection, SOS alerts, and boundary events across managed accounts.
        </Typography>
      </Box>

      <Box
        component="form"
        onSubmit={handleLookup}
        sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          alignItems: 'center',
          bgcolor: '#f8fafc',
          p: 2,
          border: '1px solid #e2e8f0',
          borderLeft: '4px solid #0284c7',
          borderRadius: 1,
          mb: 2,
        }}
      >
        {/* ① Select time period */}
        <TextField
          type="date"
          size="small"
          label="Start Time"
          focused
          value={start}
          onChange={event => setStart(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Start date' } }}
          sx={field}
        />
        <TextField
          type="date"
          size="small"
          label="End Time"
          focused
          value={end}
          onChange={event => setEnd(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'End date', min: start } }}
          sx={field}
        />

        {/* ② Select the sub-distributor or end-user under management */}
        <TextField
          select
          size="small"
          value={account}
          onChange={event => setAccount(event.target.value)}
          slotProps={{
            select: {
              displayEmpty: true,
              inputProps: { 'aria-label': 'Sub-distributor or end-user' },
              MenuProps: menuProps,
            },
          }}
          sx={{ ...field, minWidth: 210 }}
        >
          <MenuItem value="">Sub-distributor / End-user: All</MenuItem>
          {accounts.map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        {/* Scope selector */}
        <TextField
          select
          size="small"
          value={scope}
          onChange={event => setScope(event.target.value)}
          slotProps={{ select: { inputProps: { 'aria-label': 'Management Scope' }, MenuProps: menuProps } }}
          sx={{ ...field, minWidth: 170 }}
        >
          {['Only self', 'Include subcompany'].map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        {/* ③ Select the alarm type */}
        <TextField
          select
          size="small"
          value={type}
          onChange={event => setType(event.target.value)}
          slotProps={{ select: { inputProps: { 'aria-label': 'Alarm type' }, MenuProps: menuProps } }}
          sx={{ ...field, minWidth: 180 }}
        >
          {alarmTypes.map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        {/* ④ Input the IMEI number */}
        <TextField
          size="small"
          placeholder="Input IMEI number"
          value={imei}
          onChange={event => setImei(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'IMEI number' } }}
          sx={field}
        />

        {/* ⑤ Click "Lookup" */}
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          sx={{ bgcolor: '#0284c7', borderRadius: 0.5, height: 40, px: 3, fontWeight: 600, textTransform: 'none' }}
        >
          Lookup
        </Button>
      </Box>

      {(validationError || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError || error}
        </Alert>
      )}

      {/* ⑥ Showing up all the alarms as selected */}
      <Box sx={{ overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 1, minHeight: 'max(360px, calc(100dvh - 420px))' }}>
        <Table sx={{ minWidth: 1200 }}>
          <TableHead>
            <TableRow>
              {[
                'Device Name',
                'Device Model',
                'IMEI',
                'Belongs Company / Account',
                'Alarm Type',
                'Exception Time',
                'Location Time',
                'State',
              ].map(label => (
                <TableCell key={label} sx={{ ...cell, bgcolor: '#f8fafc', fontWeight: 700, position: 'sticky', top: 0, zIndex: 1 }}>
                  {label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(({ alert, device }) => (
              <TableRow key={alert.id} hover>
                <TableCell sx={cell}>{device?.device_name ?? device?.serial_number ?? alert.device_name ?? '-'}</TableCell>
                <TableCell sx={cell}>{device?.device_model ?? alert.device_model ?? 'C05 Watch'}</TableCell>
                <TableCell sx={{ ...cell, fontFamily: 'monospace', fontWeight: 600 }}>{device?.imei ?? alert.imei ?? '-'}</TableCell>
                <TableCell sx={cell}>{device?.company ?? (alert as any).company ?? 'Trackin360 Global'}</TableCell>
                <TableCell sx={{ ...cell, fontWeight: 600, color: '#dc2626' }}>{alert.message || alert.type}</TableCell>
                <TableCell sx={cell}>{displayTime(alert.created_at)}</TableCell>
                <TableCell sx={cell}>{displayTime(alert.location_time)}</TableCell>
                <TableCell sx={cell}>{alert.status || 'Resolved'}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={8} sx={{ ...cell, textAlign: 'center', color: '#94a3b8', py: 4 }}>
                  {loading ? 'Loading...' : 'No matching alarms found for selected parameters.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      {/* Pagination Footer */}
      <Box sx={{ border: '1px solid #e2e8f0', borderTop: 0, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.2, bgcolor: '#f8fafc', flexWrap: 'wrap' }}>
        <Button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} sx={{ minWidth: 28, p: 0.3 }}>
          {'<'}
        </Button>
        <Box sx={{ bgcolor: '#0284c7', color: '#fff', px: 1.5, py: 0.3, borderRadius: 0.5, fontWeight: 700, fontSize: 13 }}>
          {currentPage + 1} / {pages}
        </Box>
        <Button aria-label="Next page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} sx={{ minWidth: 28, p: 0.3 }}>
          {'>'}
        </Button>
        <Button aria-label="Refresh alarms" onClick={reload} disabled={loading} sx={{ minWidth: 28, color: '#475569' }}>
          <RefreshOutlined sx={{ fontSize: 18 }} />
        </Button>
        <Typography sx={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>Total {rows.length} Alarms</Typography>
        <TextField
          select
          size="small"
          value={pageSize}
          onChange={event => {
            setPageSize(Number(event.target.value))
            setPage(0)
          }}
          slotProps={{ select: { inputProps: { 'aria-label': 'Rows per page' } } }}
          sx={{ ml: 'auto', '& .MuiOutlinedInput-root': { borderRadius: 1 }, '& .MuiSelect-select': { py: 0.4, fontSize: 12 } }}
        >
          {[12, 20, 50, 100].map(value => (
            <MenuItem key={value} value={value}>
              {value} Rows/Page
            </MenuItem>
          ))}
        </TextField>
      </Box>
    </Stack>
  )
}
