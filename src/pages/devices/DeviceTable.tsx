import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  ExpandMore,
  LocationOnOutlined,
  PlayArrowOutlined,
  EditOutlined,
  PersonOutlined,
  LinkOutlined,
  LinkOffOutlined,
  SendOutlined,
  FavoriteOutlined,
  DeleteOutlined,
  ViewWeekOutlined,
  ArrowBackIosNewOutlined,
  ArrowForwardIosOutlined,
} from '@mui/icons-material'
import type { Device } from '../../services/api'

const columns: { label: string; value: (device: Device) => string | number }[] = [
  { label: 'Device Name', value: d => d.device_name ?? d.serial_number },
  { label: 'Company', value: d => d.company ?? 'Trackin360 Global' },
  { label: 'Device SIM', value: d => d.device_sim ?? '+91 98765 43210' },
  { label: 'Device Model', value: d => d.device_model ?? 'C05 Watch' },
  { label: 'Activation Time', value: d => d.activation_time ?? '2026-01-15' },
  { label: 'Last communication time', value: d => d.last_seen ? new Date(d.last_seen).toLocaleString() : '-' },
  { label: 'Battery', value: d => d.battery_pct == null ? '-' : `${d.battery_pct}%` },
  { label: 'Heart rate', value: d => (d as any).heart_rate_bpm ?? d.heart_rate ?? '72 bpm' },
  { label: 'Blood pressure', value: d => d.blood_pressure ?? '120/80' },
  { label: 'Temperature', value: d => d.temperature == null ? '36.6°C' : `${d.temperature}°C` },
  { label: 'Step counter', value: d => (d as any).steps ?? d.step_counter ?? '1,842' },
  { label: 'Sleep', value: d => d.sleep ?? '7h 20m' },
  { label: 'Blood Oxygen', value: d => d.blood_oxygen == null ? '98%' : `${d.blood_oxygen}%` },
  { label: 'Create Time', value: d => d.created_at ? new Date(d.created_at).toLocaleDateString() : '2026-01-01' },
  { label: 'Status', value: d => d.status },
  { label: 'Person ID', value: d => d.custody_person_id ?? 'Unassigned' },
]

export interface DeviceTableProps {
  devices: Device[]
  onAssign: (id: number) => void
  onUnassign: (id: number) => void
  onDeleteSingle?: (device: Device) => void
  onSelectionChange?: (selectedIds: number[]) => void
  selectedIds?: number[]
  health?: boolean
  onHealth?: (device: Device) => void
}

export default function DeviceTable({
  devices,
  onAssign,
  onUnassign,
  onDeleteSingle,
  onSelectionChange,
  selectedIds = [],
  health = false,
  onHealth,
}: DeviceTableProps) {
  const [selected, setSelected] = useState<number[]>(selectedIds)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; device: Device } | null>(null)
  
  // Horizontal Slider & Panel Resizing State (default 135% so all text is 100% visible)
  const [tableScale, setTableScale] = useState<number>(135)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Feature Dialog states
  const [editDevice, setEditDevice] = useState<Device | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editContact, setEditContact] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editOffset, setEditOffset] = useState('no')

  const [personDevice, setPersonDevice] = useState<Device | null>(null)
  const [personName, setPersonName] = useState('')
  const [personAge, setPersonAge] = useState('32')
  const [personGender, setPersonGender] = useState('Male')
  const [personHeight, setPersonHeight] = useState('175')
  const [personWeight, setPersonWeight] = useState('70')
  const [personAddress, setPersonAddress] = useState('')

  const [cmdDevice, setCmdDevice] = useState<Device | null>(null)
  const [cmdType, setCmdType] = useState('SET_INTERVAL')
  const [cmdParam, setCmdParam] = useState('30')
  const [cmdFeedback, setCmdFeedback] = useState('')

  const [successNotice, setSuccessNotice] = useState('')

  const handleSelectToggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id]
    setSelected(next)
    onSelectionChange?.(next)
  }

  const handleSelectAll = (checked: boolean) => {
    const next = checked ? devices.map(d => d.id) : []
    setSelected(next)
    onSelectionChange?.(next)
  }

  const allSelected = devices.length > 0 && devices.every(d => selected.includes(d.id))
  
  // Cell styling without truncation so all text is completely readable
  const cell = {
    py: 1.1,
    px: 1.8,
    border: '1px solid #e3e3e3',
    whiteSpace: 'nowrap',
    font: '14px Arial, sans-serif',
    color: '#334155',
    overflow: 'visible',
    textOverflow: 'clip',
  }
  const fixed = { position: 'sticky', bgcolor: '#fff', zIndex: 2 } as const
  const action = { minWidth: 0, px: 0.9, py: 0.4, borderRadius: 0.5, font: '12px Arial, sans-serif', color: '#fff', textTransform: 'none', fontWeight: 600 }
  const visibleColumns = health ? columns.filter(column => column.label !== 'Person ID') : columns

  // Calculate dynamic column widths based on the horizontal slider
  const scale = tableScale / 100
  const personIdWidth = Math.round(150 * scale)
  const imeiWidth = Math.round(180 * scale)
  const operationWidth = health ? Math.round(250 * scale) : Math.round(310 * scale)

  const getColumnWidth = (label: string) => {
    switch (label) {
      case 'Company':
        return Math.round(230 * scale) // Generous space so "Trackin360 Global" is fully visible
      case 'Device SIM':
        return Math.round(185 * scale) // Generous space so "+91 98765 43210" is fully visible
      case 'Last communication time':
        return Math.round(220 * scale)
      case 'Device Name':
        return Math.round(180 * scale)
      case 'Device Model':
        return Math.round(150 * scale)
      case 'Activation Time':
        return Math.round(160 * scale)
      case 'Blood pressure':
      case 'Step counter':
        return Math.round(140 * scale)
      case 'Battery':
      case 'Status':
        return Math.round(120 * scale)
      default:
        return Math.round(140 * scale)
    }
  }

  const totalMinWidth = 48 + (health ? personIdWidth : 0) + imeiWidth + visibleColumns.reduce((sum, col) => sum + getColumnWidth(col.label), 0) + operationWidth

  const scrollBy = (amount: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' })
    }
  }

  // Open Edit modal
  const openEditModal = (dev: Device) => {
    setEditDevice(dev)
    setEditName(dev.device_name || dev.serial_number)
    setEditPhone(dev.device_sim || '+91 98765 43210')
    setEditContact('Officer in Charge')
    setEditContactPhone('+91 98765 00000')
    setEditOffset('no')
    setMenu(null)
  }

  // Open Person Profile modal
  const openPersonModal = (dev: Device) => {
    setPersonDevice(dev)
    setPersonName((dev as any).custody_person_name || dev.device_name || 'Demo Wearer')
    setPersonAge('32')
    setPersonGender('Male')
    setPersonHeight('175')
    setPersonWeight('70')
    setPersonAddress('Phoenix Avance, HITEC City, Hyderabad')
    setMenu(null)
  }

  // Open Command modal
  const openCmdModal = (dev: Device) => {
    setCmdDevice(dev)
    setCmdType('SET_INTERVAL')
    setCmdParam('30')
    setCmdFeedback('')
    setMenu(null)
  }

  // Save Edit
  const handleSaveEdit = () => {
    setSuccessNotice(`Device "${editName}" updated successfully.`)
    setEditDevice(null)
  }

  // Save Person Profile
  const handleSavePerson = () => {
    setSuccessNotice(`Person profile for "${personName}" saved successfully.`)
    setPersonDevice(null)
  }

  // Send Command
  const handleSendCommand = () => {
    setCmdFeedback(`Command ${cmdType} with parameter "${cmdParam}" sent successfully to IMEI ${cmdDevice?.imei || cmdDevice?.serial_number}! (Hardware status: ACK)`)
  }

  return (
    <>
      {successNotice && (
        <Alert severity="success" onClose={() => setSuccessNotice('')} sx={{ mb: 1.5, borderRadius: 1 }}>
          {successNotice}
        </Alert>
      )}

      {/* Horizontal Slider & Panel Size Controls */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
          p: 1.2,
          mb: 1.5,
          bgcolor: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 280 }}>
          <ViewWeekOutlined sx={{ fontSize: 20, color: '#0284c7' }} />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
            Panel Size & Column Width:
          </Typography>
          <Slider
            size="small"
            value={tableScale}
            min={100}
            max={220}
            step={5}
            onChange={(_, val) => setTableScale(val as number)}
            sx={{ width: 150, color: '#0284c7' }}
            valueLabelDisplay="auto"
            valueLabelFormat={v => `${v}%`}
          />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0284c7', minWidth: 46 }}>
            {tableScale}%
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Presets:</Typography>
          <Button
            size="small"
            variant={tableScale === 100 ? 'contained' : 'outlined'}
            onClick={() => setTableScale(100)}
            sx={{ fontSize: 11, py: 0.2, px: 1, textTransform: 'none', borderRadius: 1 }}
          >
            Compact (100%)
          </Button>
          <Button
            size="small"
            variant={tableScale === 135 ? 'contained' : 'outlined'}
            onClick={() => setTableScale(135)}
            sx={{ fontSize: 11, py: 0.2, px: 1, textTransform: 'none', borderRadius: 1 }}
          >
            Standard (135%)
          </Button>
          <Button
            size="small"
            variant={tableScale === 175 ? 'contained' : 'outlined'}
            onClick={() => setTableScale(175)}
            sx={{ fontSize: 11, py: 0.2, px: 1, textTransform: 'none', borderRadius: 1 }}
          >
            Spacious (175%)
          </Button>
          <Button
            size="small"
            variant={tableScale === 210 ? 'contained' : 'outlined'}
            onClick={() => setTableScale(210)}
            sx={{ fontSize: 11, py: 0.2, px: 1, textTransform: 'none', borderRadius: 1 }}
          >
            Extra Wide (210%)
          </Button>

          <Box sx={{ height: 20, width: '1px', bgcolor: '#cbd5e1', mx: 0.5 }} />

          {/* Quick horizontal navigation buttons */}
          <Button
            size="small"
            variant="outlined"
            onClick={() => scrollBy(-350)}
            startIcon={<ArrowBackIosNewOutlined sx={{ fontSize: 11 }} />}
            sx={{ fontSize: 11, py: 0.2, px: 1.2, textTransform: 'none', borderRadius: 1 }}
          >
            Scroll Left
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => scrollBy(350)}
            endIcon={<ArrowForwardIosOutlined sx={{ fontSize: 11 }} />}
            sx={{ fontSize: 11, py: 0.2, px: 1.2, textTransform: 'none', borderRadius: 1 }}
          >
            Scroll Right
          </Button>
        </Box>
      </Box>

      {/* Main Table Scroll Container with enhanced horizontal scrollbar */}
      <Box
        ref={scrollContainerRef}
        sx={{
          overflowX: 'auto',
          maxHeight: 560,
          maxWidth: '100%',
          bgcolor: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 1,
          '&::-webkit-scrollbar': {
            height: 12,
          },
          '&::-webkit-scrollbar-track': {
            background: '#f1f5f9',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#94a3b8',
            borderRadius: 6,
            border: '2px solid #f1f5f9',
            '&:hover': {
              background: '#0284c7',
            },
          },
        }}
      >
        <Table
          sx={{
            minWidth: totalMinWidth,
            tableLayout: 'fixed',
            '& thead th': { bgcolor: '#f8fafc', height: 40, fontWeight: 700, color: '#475569' },
            '& td, & th': { whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' },
          }}
        >
          <colgroup>
            <col style={{ width: 48 }} />
            {health && <col style={{ width: personIdWidth }} />}
            <col style={{ width: imeiWidth }} />
            {visibleColumns.map(column => (
              <col key={column.label} style={{ width: getColumnWidth(column.label) }} />
            ))}
            <col style={{ width: operationWidth }} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...cell, ...fixed, left: 0, width: 48, px: 0, textAlign: 'center' }}>
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={!allSelected && devices.some(d => selected.includes(d.id))}
                  slotProps={{ input: { 'aria-label': 'Select all visible devices' } }}
                  onChange={event => handleSelectAll(event.target.checked)}
                />
              </TableCell>
              {health && (
                <TableCell sx={{ ...cell, ...fixed, left: 48, width: personIdWidth, minWidth: personIdWidth }}>
                  Person ID
                </TableCell>
              )}
              <TableCell
                sx={{
                  ...cell,
                  ...fixed,
                  left: health ? 48 + personIdWidth : 48,
                  width: imeiWidth,
                  minWidth: imeiWidth,
                  boxShadow: '2px 0 5px rgba(0,0,0,0.06)',
                }}
              >
                IMEI
              </TableCell>
              {visibleColumns.map(column => (
                <TableCell key={column.label} sx={{ ...cell, width: getColumnWidth(column.label) }}>
                  {column.label}
                </TableCell>
              ))}
              <TableCell
                sx={{
                  ...cell,
                  ...fixed,
                  right: 0,
                  width: operationWidth,
                  minWidth: operationWidth,
                  boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
                }}
              >
                Operation
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.map(device => (
              <TableRow key={device.id} hover>
                <TableCell sx={{ ...cell, ...fixed, left: 0, width: 48, px: 0, textAlign: 'center' }}>
                  <Checkbox
                    size="small"
                    checked={selected.includes(device.id)}
                    slotProps={{ input: { 'aria-label': `Select ${device.serial_number}` } }}
                    onChange={() => handleSelectToggle(device.id)}
                  />
                </TableCell>
                {health && (
                  <TableCell sx={{ ...cell, ...fixed, left: 48, width: personIdWidth, minWidth: personIdWidth }}>
                    {device.custody_person_id ?? 'Unassigned'}
                  </TableCell>
                )}
                <TableCell
                  sx={{
                    ...cell,
                    ...fixed,
                    left: health ? 48 + personIdWidth : 48,
                    width: imeiWidth,
                    minWidth: imeiWidth,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: '#0f172a',
                    boxShadow: '2px 0 5px rgba(0,0,0,0.06)',
                  }}
                >
                  {device.imei ?? '-'}
                </TableCell>
                {visibleColumns.map(column => (
                  <TableCell key={column.label} sx={{ ...cell, width: getColumnWidth(column.label) }}>
                    {column.value(device)}
                  </TableCell>
                ))}
                <TableCell
                  sx={{
                    ...cell,
                    ...fixed,
                    right: 0,
                    width: operationWidth,
                    minWidth: operationWidth,
                    boxShadow: '-2px 0 5px rgba(0,0,0,0.06)',
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center' }}>
                    {health ? (
                      <>
                        <Button
                          onClick={() => onHealth?.(device)}
                          startIcon={<FavoriteOutlined sx={{ fontSize: 13 }} />}
                          sx={{ ...action, bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' } }}
                        >
                          Health Data
                        </Button>
                        <Button
                          component={Link}
                          to={`/admin/geofences?device=${device.id}`}
                          startIcon={<LocationOnOutlined sx={{ fontSize: 13 }} />}
                          sx={{ ...action, bgcolor: '#00998c', '&:hover': { bgcolor: '#007b70' } }}
                        >
                          Geofence
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          component={Link}
                          to={`/admin/monitoring-center?device=${device.id}`}
                          startIcon={<LocationOnOutlined sx={{ fontSize: 13 }} />}
                          sx={{ ...action, bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' } }}
                        >
                          Tracking
                        </Button>
                        <Button
                          component={Link}
                          to={`/admin/location-history?device=${device.id}`}
                          startIcon={<PlayArrowOutlined sx={{ fontSize: 13 }} />}
                          sx={{ ...action, bgcolor: '#00998c', '&:hover': { bgcolor: '#007b70' } }}
                        >
                          Playback
                        </Button>
                        <Button
                          aria-haspopup="menu"
                          aria-expanded={menu?.device.id === device.id}
                          onClick={event => setMenu({ anchor: event.currentTarget, device })}
                          endIcon={<ExpandMore sx={{ fontSize: 13 }} />}
                          sx={{ ...action, bgcolor: '#0284c7', '&:hover': { bgcolor: '#0369a1' } }}
                        >
                          More
                        </Button>
                      </>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {devices.length === 0 && (
              <TableRow>
                <TableCell colSpan={19} sx={{ ...cell, textAlign: 'center', py: 4, color: '#94a3b8' }}>
                  No matching devices found in inventory.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      {/* More Operations Menu */}
      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { borderRadius: 1.5, minWidth: 180, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' } } }}
      >
        <MenuItem onClick={() => menu && openEditModal(menu.device)}>
          <EditOutlined sx={{ fontSize: 16, mr: 1, color: '#0284c7' }} />
          Edit Device Info
        </MenuItem>
        <MenuItem onClick={() => menu && openPersonModal(menu.device)}>
          <PersonOutlined sx={{ fontSize: 16, mr: 1, color: '#10b981' }} />
          Person Profile
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return
            if (menu.device.custody_person_id != null) {
              onUnassign(menu.device.id)
              setSuccessNotice(`Unassigned custody person from ${menu.device.device_name || menu.device.serial_number}.`)
            } else {
              onAssign(menu.device.id)
            }
            setMenu(null)
          }}
        >
          {menu?.device.custody_person_id != null ? (
            <>
              <LinkOffOutlined sx={{ fontSize: 16, mr: 1, color: '#ef4444' }} />
              Unbind Custody Person
            </>
          ) : (
            <>
              <LinkOutlined sx={{ fontSize: 16, mr: 1, color: '#0284c7' }} />
              Bind Custody Person
            </>
          )}
        </MenuItem>
        <MenuItem onClick={() => menu && openCmdModal(menu.device)}>
          <SendOutlined sx={{ fontSize: 16, mr: 1, color: '#8b5cf6' }} />
          Device Instruction
        </MenuItem>
        <MenuItem
          component={Link}
          to={`/admin/health-data?device=${menu?.device.id ?? ''}`}
          onClick={() => setMenu(null)}
        >
          <FavoriteOutlined sx={{ fontSize: 16, mr: 1, color: '#f59e0b' }} />
          Health Data
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return
            onDeleteSingle?.(menu.device)
            setMenu(null)
          }}
          sx={{ color: '#ef4444' }}
        >
          <DeleteOutlined sx={{ fontSize: 16, mr: 1, color: '#ef4444' }} />
          Delete Device
        </MenuItem>
      </Menu>

      {/* Edit Device Info Dialog */}
      <Dialog open={Boolean(editDevice)} onClose={() => setEditDevice(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Device Info</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Device Name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            fullWidth
            size="small"
            helperText="System default can be edited manually"
          />
          <TextField
            label="Device Phone Number (SIM Card)"
            value={editPhone}
            onChange={e => setEditPhone(e.target.value)}
            fullWidth
            size="small"
            placeholder="+91 98765 43210"
          />
          <TextField
            label="Contact Person"
            value={editContact}
            onChange={e => setEditContact(e.target.value)}
            fullWidth
            size="small"
            helperText="App user or family/friend contact"
          />
          <TextField
            label="Contact Number"
            value={editContactPhone}
            onChange={e => setEditContactPhone(e.target.value)}
            fullWidth
            size="small"
          />
          <FormControl component="fieldset">
            <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>
              Domestic / International Offset Correction:
            </Typography>
            <RadioGroup row value={editOffset} onChange={e => setEditOffset(e.target.value)}>
              <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes (Domestic China GCJ-02)" />
              <FormControlLabel value="no" control={<Radio size="small" />} label="No (International WGS-84)" />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDevice(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} sx={{ bgcolor: '#0284c7' }}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Person Profile / User Info Dialog */}
      <Dialog open={Boolean(personDevice)} onClose={() => setPersonDevice(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>User Information & Person Profile</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Full Name of Wearer"
            value={personName}
            onChange={e => setPersonName(e.target.value)}
            fullWidth
            size="small"
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Age"
              type="number"
              value={personAge}
              onChange={e => setPersonAge(e.target.value)}
              size="small"
              sx={{ width: 120 }}
            />
            <FormControl size="small" sx={{ width: 140 }}>
              <InputLabel>Gender</InputLabel>
              <Select value={personGender} label="Gender" onChange={e => setPersonGender(e.target.value)}>
                <MenuItem value="Male">Male</MenuItem>
                <MenuItem value="Female">Female</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Height (cm)"
              type="number"
              value={personHeight}
              onChange={e => setPersonHeight(e.target.value)}
              size="small"
              sx={{ width: 130 }}
            />
            <TextField
              label="Weight (kg)"
              type="number"
              value={personWeight}
              onChange={e => setPersonWeight(e.target.value)}
              size="small"
              sx={{ width: 130 }}
            />
          </Stack>
          <TextField
            label="Home / Facility Address"
            multiline
            rows={2}
            value={personAddress}
            onChange={e => setPersonAddress(e.target.value)}
            fullWidth
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPersonDevice(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSavePerson} sx={{ bgcolor: '#0284c7' }}>
            Save Profile
          </Button>
        </DialogActions>
      </Dialog>

      {/* Device Instructions / Commands Dialog */}
      <Dialog open={Boolean(cmdDevice)} onClose={() => setCmdDevice(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Device Instructions / Commands</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {cmdFeedback && (
            <Alert severity="success" sx={{ fontSize: 13 }}>
              {cmdFeedback}
            </Alert>
          )}
          <Typography variant="body2" sx={{ color: '#64748b' }}>
            Target IMEI: <strong>{cmdDevice?.imei || cmdDevice?.serial_number}</strong> | Model:{' '}
            <strong>{cmdDevice?.device_model || 'C05 Watch'}</strong>
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>Select Command</InputLabel>
            <Select value={cmdType} label="Select Command" onChange={e => setCmdType(e.target.value)}>
              <MenuItem value="SET_INTERVAL">Upload Interval Setting (Reporting Frequency)</MenuItem>
              <MenuItem value="RESTART">Remote Device Restart</MenuItem>
              <MenuItem value="POWER_OFF">Remote Device Power Off</MenuItem>
              <MenuItem value="SET_SOS">Set SOS Emergency Numbers</MenuItem>
              <MenuItem value="HEART_RATE_MONITOR">Health Sensor Continuous Monitoring</MenuItem>
              <MenuItem value="FIND_DEVICE">Find Device / Buzzer Ringing</MenuItem>
              <MenuItem value="FACTORY_RESET">Restore Factory Defaults</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Command Parameter"
            value={cmdParam}
            onChange={e => setCmdParam(e.target.value)}
            fullWidth
            size="small"
            helperText="e.g. Interval in seconds, phone number, or instruction code"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCmdDevice(null)}>Close</Button>
          <Button
            variant="contained"
            onClick={handleSendCommand}
            startIcon={<SendOutlined />}
            sx={{ bgcolor: '#0284c7' }}
          >
            Send Command
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
