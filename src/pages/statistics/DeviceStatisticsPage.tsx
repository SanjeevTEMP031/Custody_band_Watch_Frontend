import { useCallback, useMemo, useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { FileDownloadOutlined } from '@mui/icons-material'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listDevices } from '../../services/api'
import StatisticsSectionNav from '../../components/layout/StatisticsSectionNav'

const dayKey = (value: string | Date) => {
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

// 4.2 ③ Select protocol options
const protocolOptions = ['All Protocols', 'JT808', 'GT06', 'Trackin360 Standard', 'Concox', 'Custom TCP/UDP']

// 4.2 ④ Select status options
const statusOptions = ['All Status', 'Online', 'Offline', 'Not Activated', 'Expired']

export default function DeviceStatisticsPage() {
  const today = dayKey(new Date())

  // 4.2 ① Select time period
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)

  // 4.2 ② Select account
  const [parent, setParent] = useState('')
  const [company, setCompany] = useState('')

  // 4.2 ③ Select protocol
  const [protocol, setProtocol] = useState('All Protocols')

  // 4.2 ④ Select status
  const [status, setStatus] = useState('All Status')

  // Device model selector (from 4.2 spec description)
  const [model, setModel] = useState('')

  // 4.2 ⑤ Select scope
  const [scope, setScope] = useState('Only self')

  // Applied filters
  const [filters, setFilters] = useState({
    start: today,
    end: today,
    parent: '',
    company: '',
    protocol: 'All Protocols',
    status: 'All Status',
    model: '',
    scope: 'Only self',
  })

  const [showTable, setShowTable] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(() => (getAccessToken() ? listDevices(0, 500) : Promise.resolve([])), [])
  const { data, loading, error, reload } = useApiData(load)

  const parents = useMemo(
    () => [...new Set((data ?? []).map(device => device.parent_customer).filter((v): v is string => Boolean(v)))],
    [data],
  )

  const companies = useMemo(
    () =>
      [
        ...new Set(
          (data ?? [])
            .filter(device => !parent || device.parent_customer === parent)
            .map(device => device.company)
            .filter((v): v is string => Boolean(v)),
        ),
      ],
    [data, parent],
  )

  const models = useMemo(
    () => [...new Set((data ?? []).map(device => device.device_model || 'C05 Watch').filter(Boolean))],
    [data],
  )

  // 4.2 ⑧ Showing all device details with filters applied
  const devices = useMemo(
    () =>
      (data ?? []).filter(device => {
        const timestamp = device.created_at || device.activation_time || device.last_seen
        const day = timestamp ? dayKey(timestamp) : ''
        const matchesDate = day >= filters.start && day <= filters.end
        const matchesParent = !filters.parent || device.parent_customer === filters.parent
        const matchesCompany = !filters.company || device.company === filters.company
        const normalizedStatus = (device?.status || 'offline').toLowerCase()
        const matchesStatus =
          filters.status === 'All Status' ||
          (filters.status === 'Online' && normalizedStatus === 'online') ||
          (filters.status === 'Offline' && normalizedStatus === 'offline') ||
          (filters.status === 'Not Activated' && ['inactive', 'not activated'].includes(normalizedStatus)) ||
          (filters.status === 'Expired' && normalizedStatus === 'expired')
        const matchesModel = !filters.model || (device.device_model || 'C05 Watch') === filters.model
        const matchesScope = filters.scope === 'Include subcompany' || device.is_subcompany !== true
        return matchesDate && matchesParent && matchesCompany && matchesStatus && matchesModel && matchesScope
      }),
    [data, filters],
  )

  // 4.2 ⑥ Click "Lookup" to display all device
  const handleLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!start || !end || start > end) {
      setMessage('Choose an end date on or after the start date.')
      return
    }
    setMessage('')
    setFilters({
      start,
      end,
      parent,
      company,
      protocol,
      status,
      model,
      scope,
    })
    setShowTable(true)
    reload()
  }

  // 4.2 ⑦ Click "Import Excel" to export list
  const exportExcel = async () => {
    if (!start || !end || start > end) {
      setMessage('Choose an end date on or after the start date.')
      return
    }
    setExporting(true)
    setMessage('')
    try {
      const { downloadDeviceWorkbook } = await import('../devices/deviceExport')
      downloadDeviceWorkbook(devices)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to export the spreadsheet.')
    } finally {
      setExporting(false)
    }
  }

  const control = {
    flex: '1 1 150px',
    minWidth: 140,
    '& .MuiOutlinedInput-root': { borderRadius: 0, bgcolor: '#fff', font: '14px Arial, sans-serif' },
  }

  const menuProps = {
    slotProps: {
      paper: {
        sx: {
          borderRadius: 0,
          '& .MuiMenuItem-root': { minHeight: 36, font: '14px Arial, sans-serif' },
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
    py: 1,
    px: 1.8,
    color: '#475569',
    font: '14px Arial, sans-serif',
    whiteSpace: 'nowrap',
  }

  return (
    <Stack spacing={0} sx={{ bgcolor: '#fff', minHeight: 'calc(100vh - 180px)', minWidth: 0, p: 2 }}>
      {/* Statistics Section Navigation Tabs */}
      <StatisticsSectionNav />

      {/* 4.2 Header */}
      <Box sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
          Device Statistics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Analyze total equipment counts, connection protocols, and hardware statuses with batch export.
        </Typography>
      </Box>

      {/* 4.2 Form Filter Controls */}
      <Box
        component="form"
        onSubmit={handleLookup}
        sx={{
          bgcolor: '#f8fafc',
          p: 2,
          border: '1px solid #e2e8f0',
          borderLeft: '4px solid #0284c7',
          borderRadius: 1,
          mb: 2,
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* ① Select time period */}
          <TextField
            type="date"
            size="small"
            label="Start Time"
            focused
            value={start}
            onChange={event => setStart(event.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Start date' } }}
            sx={control}
          />
          <TextField
            type="date"
            size="small"
            label="End Time"
            focused
            value={end}
            onChange={event => setEnd(event.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'End date', min: start } }}
            sx={control}
          />

          {/* ② Select account */}
          <TextField
            select
            size="small"
            value={parent}
            onChange={event => {
              setParent(event.target.value)
              setCompany('')
            }}
            slotProps={{ select: { displayEmpty: true, inputProps: { 'aria-label': 'Parent Customer' }, MenuProps: menuProps } }}
            sx={control}
          >
            <MenuItem value="">Parent Customer: All</MenuItem>
            {parents.map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            value={company}
            onChange={event => setCompany(event.target.value)}
            slotProps={{ select: { displayEmpty: true, inputProps: { 'aria-label': 'Customer Account' }, MenuProps: menuProps } }}
            sx={control}
          >
            <MenuItem value="">Account / Company: All</MenuItem>
            {companies.map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          {/* ③ Select protocol */}
          <TextField
            select
            size="small"
            value={protocol}
            onChange={event => setProtocol(event.target.value)}
            slotProps={{ select: { inputProps: { 'aria-label': 'Communication Protocol' }, MenuProps: menuProps } }}
            sx={control}
          >
            {protocolOptions.map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          {/* ④ Select status */}
          <TextField
            select
            size="small"
            value={status}
            onChange={event => setStatus(event.target.value)}
            slotProps={{ select: { inputProps: { 'aria-label': 'Device Status' }, MenuProps: menuProps } }}
            sx={control}
          >
            {statusOptions.map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          {/* Device Model Selector */}
          <TextField
            select
            size="small"
            value={model}
            onChange={event => setModel(event.target.value)}
            slotProps={{ select: { displayEmpty: true, inputProps: { 'aria-label': 'Device Model' }, MenuProps: menuProps } }}
            sx={control}
          >
            <MenuItem value="">Device Model: All</MenuItem>
            {models.map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          {/* ⑤ Select scope */}
          <TextField
            select
            size="small"
            value={scope}
            onChange={event => setScope(event.target.value)}
            slotProps={{ select: { inputProps: { 'aria-label': 'Management Scope' }, MenuProps: menuProps } }}
            sx={control}
          >
            {['Only self', 'Include subcompany'].map(value => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          {/* ⑥ Click "Lookup" to display all device */}
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ bgcolor: '#0284c7', borderRadius: 0.5, height: 40, px: 2.5, fontWeight: 600, textTransform: 'none' }}
          >
            Lookup
          </Button>

          {/* ⑦ Click "Import Excel" to export list */}
          <Button
            type="button"
            variant="contained"
            onClick={() => void exportExcel()}
            disabled={loading || exporting}
            startIcon={<FileDownloadOutlined />}
            sx={{ bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' }, borderRadius: 0.5, height: 40, px: 2, fontWeight: 600, textTransform: 'none' }}
          >
            {exporting ? 'Exporting...' : 'Import Excel'}
          </Button>
        </Box>
      </Box>

      {(message || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {message || error}
        </Alert>
      )}

      {/* ⑧ Showing all device details */}
      {showTable && (
        <Box sx={{ overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 1, minHeight: 'max(360px, calc(100dvh - 420px))' }}>
          <Table sx={{ minWidth: 1600 }}>
            <TableHead>
              <TableRow>
                {[
                  'Company Name',
                  'Device Name',
                  'IMEI',
                  'Device SIM',
                  'Device Model',
                  'Protocol',
                  'Status',
                  'Create Time',
                  'Activate Time',
                  'Device expire time',
                  'Last communication time',
                ].map(label => (
                  <TableCell key={label} sx={{ ...cell, bgcolor: '#f8fafc', fontWeight: 700, position: 'sticky', top: 0, zIndex: 1 }}>
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.map(device => {
                const isOnline = (device?.status || '').toLowerCase() === 'online'
                return (
                  <TableRow key={device.id} hover>
                    <TableCell sx={cell}>{device.company || 'Trackin360 Global'}</TableCell>
                    <TableCell sx={{ ...cell, fontWeight: 600 }}>{device.device_name ?? device.serial_number}</TableCell>
                    <TableCell sx={{ ...cell, fontFamily: 'monospace', fontWeight: 600 }}>{device.imei}</TableCell>
                    <TableCell sx={cell}>{device.device_sim || '+91 98765 43210'}</TableCell>
                    <TableCell sx={cell}>{device.device_model || 'C05 Watch'}</TableCell>
                    <TableCell sx={cell}>{(device as any).protocol || 'JT808 / TCP'}</TableCell>
                    <TableCell sx={cell}>
                      <Chip
                        size="small"
                        label={(device.status || 'Offline').toUpperCase()}
                        sx={{
                          height: 22,
                          fontSize: 11,
                          fontWeight: 700,
                          bgcolor: isOnline ? '#dcfce7' : '#f1f5f9',
                          color: isOnline ? '#166534' : '#475569',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={cell}>{device.created_at ? new Date(device.created_at).toLocaleDateString() : 'N/A'}</TableCell>
                    <TableCell sx={cell}>{device.activation_time ? new Date(device.activation_time).toLocaleDateString() : 'N/A'}</TableCell>
                    <TableCell sx={cell}>{(device as any).expire_time ? new Date((device as any).expire_time).toLocaleDateString() : 'N/A'}</TableCell>
                    <TableCell sx={cell}>{device.last_seen ? new Date(device.last_seen).toLocaleString() : 'N/A'}</TableCell>
                  </TableRow>
                )
              })}
              {!devices.length && (
                <TableRow>
                  <TableCell colSpan={11} sx={{ ...cell, textAlign: 'center', color: '#94a3b8', py: 4 }}>
                    {loading ? 'Loading...' : 'No matching devices found.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
    </Stack>
  )
}
