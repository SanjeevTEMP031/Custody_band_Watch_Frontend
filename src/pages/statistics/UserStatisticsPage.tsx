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
import { FileDownloadOutlined } from '@mui/icons-material'
import { getAccessToken, listUsers } from '../../services/api'
import { useApiData } from '../../hooks/useApiData'
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

export default function UserStatisticsPage() {
  const today = dayKey(new Date())

  // 4.3 ① Select time period
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)

  // 4.3 ② Select the only self or include sub-company
  const [scope, setScope] = useState('Include subcompany')

  const [filters, setFilters] = useState({ start: today, end: today, scope: 'Include subcompany' })
  const [lookedUp, setLookedUp] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(() => (getAccessToken() ? listUsers(0, 500) : Promise.resolve([])), [])
  const { data, loading, error, reload } = useApiData(load)

  // 4.3 ④ Showing all the user details
  const users = useMemo(
    () =>
      (data ?? []).filter(user => {
        const day = dayKey(user.created_at)
        return day >= filters.start && day <= filters.end && (filters.scope === 'Include subcompany' || user.is_subcompany !== true)
      }),
    [data, filters],
  )

  const valid = () => {
    if (!start || !end || start > end) {
      setMessage('Choose an end date on or after the start date.')
      return false
    }
    setMessage('')
    return true
  }

  // 4.3 ③ Click "Lookup"
  const lookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid()) return
    setFilters({ start, end, scope })
    setLookedUp(true)
    reload()
  }

  // 4.3 ⑤ Click "Import Excel" to export data
  const exportExcel = async () => {
    if (!valid()) return
    setExporting(true)
    try {
      const { downloadUserWorkbook } = await import('./userExport')
      downloadUserWorkbook(users)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to export user statistics.')
    } finally {
      setExporting(false)
    }
  }

  const control = {
    flex: '1 1 180px',
    minWidth: 160,
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
    p: 1.2,
    font: '14px Arial, sans-serif',
    color: '#475569',
    whiteSpace: 'nowrap',
  }

  return (
    <Stack spacing={0} sx={{ bgcolor: '#fff', minHeight: 'calc(100vh - 180px)', minWidth: 0, p: 2 }}>
      {/* Statistics Section Tabs */}
      <StatisticsSectionNav />

      {/* Header */}
      <Box sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
          User Statistics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          View user count statistics in real time and export the entire user list.
        </Typography>
      </Box>

      {/* 4.3 Form Filters */}
      <Box
        component="form"
        onSubmit={lookup}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          p: 2,
          bgcolor: '#f8fafc',
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

        {/* ② Select only self or include sub-company */}
        <TextField
          select
          size="small"
          value={scope}
          onChange={event => setScope(event.target.value)}
          slotProps={{ select: { inputProps: { 'aria-label': 'Management Scope' }, MenuProps: menuProps } }}
          sx={{ ...control, minWidth: 200 }}
        >
          {['Only self', 'Include subcompany'].map(value => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>

        {/* ③ Click "Lookup" */}
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          sx={{ bgcolor: '#0284c7', borderRadius: 0.5, height: 40, px: 3, fontWeight: 600, textTransform: 'none' }}
        >
          Lookup
        </Button>

        {/* ⑤ Click "Import Excel" to export data */}
        <Button
          type="button"
          variant="contained"
          disabled={loading || exporting}
          onClick={() => void exportExcel()}
          startIcon={<FileDownloadOutlined />}
          sx={{ bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' }, borderRadius: 0.5, height: 40, px: 2, fontWeight: 600, textTransform: 'none' }}
        >
          {exporting ? 'Exporting...' : 'Import Excel'}
        </Button>
      </Box>

      {(message || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {message || error}
        </Alert>
      )}

      {/* ④ Showing all the user details */}
      <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1, minHeight: 'max(330px, calc(100dvh - 390px))', overflow: 'auto' }}>
        {lookedUp && (
          <Table sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                {['Customer Name / Company', 'Login Name / Email', 'Contact Person', 'Phone Number', 'Account Role', 'Create Time'].map(label => (
                  <TableCell key={label} sx={{ ...cell, bgcolor: '#f8fafc', fontWeight: 700, position: 'sticky', top: 0, zIndex: 1 }}>
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map(user => (
                <TableRow key={user.id} hover>
                  <TableCell sx={cell}>{user.company || 'Trackin360 Global'}</TableCell>
                  <TableCell sx={{ ...cell, fontWeight: 600 }}>{user.login_name ?? user.email}</TableCell>
                  <TableCell sx={cell}>{user.contact ?? user.full_name ?? '-'}</TableCell>
                  <TableCell sx={cell}>{user.phone || '+91 98765 43210'}</TableCell>
                  <TableCell sx={cell}>{user.role || 'End-user'}</TableCell>
                  <TableCell sx={cell}>{user.created_at ? new Date(user.created_at).toLocaleString() : '2026-01-01'}</TableCell>
                </TableRow>
              ))}
              {!users.length && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ ...cell, textAlign: 'center', color: '#94a3b8', py: 4 }}>
                    {loading ? 'Loading...' : 'No users found for selected parameters.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Box>
    </Stack>
  )
}
