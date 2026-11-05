import { useState } from 'react'
import { Box, Button, Checkbox, Stack, TextField, Typography } from '@mui/material'
import { Favorite, MonitorHeart, DirectionsWalk, Bedtime, Thermostat, WaterDrop } from '@mui/icons-material'
import type { Device } from '../../services/api'

const measurements = [
  { name: 'Heart rate', title: 'Heart Rate', unit: 'Times/Minute', color: '#2196ff', icon: Favorite },
  { name: 'Blood pressure', title: 'Blood pressure', unit: 'mmHg', color: '#ff5722', icon: MonitorHeart },
  { name: 'Step counter', title: 'Pedometer data', unit: 'Step', color: '#00998c', icon: DirectionsWalk },
  { name: 'Sleep', title: 'Sleep data', unit: 'Hours', color: '#ffba00', icon: Bedtime },
  { name: 'Temperature', title: 'Temperature data', unit: 'Degrees', color: '#00998c', icon: Thermostat },
  { name: 'Blood Oxygen', title: 'Blood Oxygen', unit: '%', color: '#00998c', icon: WaterDrop },
]
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function HealthChartPanel({ name, title, unit, imei }: { name: string; title: string; unit: string; imei: string }) {
  const [start, setStart] = useState(today), [end, setEnd] = useState(today)
  const [range, setRange] = useState(() => ({ start: today(), end: today() }))
  const [error, setError] = useState('')
  return <Box component="section" aria-label={`${name} chart`} sx={{ border: '1px solid #e3e3e3', minWidth: 0 }}>
    <Box component="form" onSubmit={event => { event.preventDefault(); if (!start || !end || start > end) { setError('Choose a valid date range.'); return } setError(''); setRange({ start, end }) }} sx={{ display: 'flex', flexWrap: 'wrap', gap: .5, alignItems: 'center', p: 1.25, bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c' }}>
      <Typography sx={{ fontSize: 14 }}>{name}</Typography>
      <TextField required type="date" size="small" value={start} onChange={e => setStart(e.target.value)} sx={{ width: 170, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: 0 } }} slotProps={{ htmlInput: { 'aria-label': `${name} start date` } }} />
      <TextField required type="date" size="small" value={end} onChange={e => setEnd(e.target.value)} sx={{ width: 170, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: 0 } }} slotProps={{ htmlInput: { min: start, 'aria-label': `${name} end date` } }} />
      <Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3, height: 38 }}>Lookup</Button>
    </Box>
    {error && <Typography role="alert" color="error" sx={{ p: 1 }}>{error}</Typography>}
    <Box sx={{ height: 410, position: 'relative', bgcolor: '#fff', p: 2.5 }}>
      <Typography sx={{ textAlign: 'center', fontSize: 19, color: '#444' }}>{title}–{imei}</Typography>
      <Typography sx={{ textAlign: 'center', color: '#666', fontSize: 13, mt: 1 }}>{range.start} To {range.end}</Typography>
      <Typography sx={{ position: 'absolute', left: 14, top: '50%', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 12, color: '#666' }}>{unit}</Typography>
      <Box sx={{ position: 'absolute', inset: '95px 25px 50px 52px', display: 'grid', placeItems: 'center', borderBottom: '1px solid #c5d5f4' }}><Typography role="status" sx={{ fontSize: 13, color: '#777', fontWeight: 600 }}>No data to display</Typography></Box>
      <Typography sx={{ position: 'absolute', bottom: 15, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: '#555' }}><Box component="span" sx={{ color: '#7bb3ef' }}>●</Box> Series 1</Typography>
    </Box>
  </Box>
}

export default function HealthDeviceDetail({ device, onBack }: { device: Device; onBack: () => void }) {
  const [visible, setVisible] = useState(['Heart rate', 'Step counter', 'Temperature', 'Blood Oxygen'])
  const info = [['Device Name', device.device_name ?? device.serial_number], ['Model', device.device_model ?? '-'], ['IMEI', device.imei ?? '-'], ['Company Name', device.company ?? '-']]
  return <Stack spacing={1.5} sx={{ bgcolor: '#fff' }}>
    <Box><Button onClick={onBack}>Back to Health Data</Button></Box>
    <Box sx={{ bgcolor: '#f2f2f2', p: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>{info.map(([label, value]) => <Box key={label} sx={{ display: 'flex', minWidth: 0, border: '1px solid #e3e3e3' }}><Typography sx={{ width: 100, flexShrink: 0, p: 1.5, bgcolor: '#e7e7e7', textAlign: 'center', fontSize: 14 }}>{label}</Typography><Typography sx={{ bgcolor: '#fff', flex: 1, p: 1.5, overflowWrap: 'anywhere', fontSize: 14 }}>{value}</Typography></Box>)}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, bgcolor: '#fff', p: 1 }}><Typography sx={{ width: 100, fontSize: 14 }}>Health Data</Typography>{measurements.map(m => <Box component="label" key={m.name} sx={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', cursor: 'pointer' }}><Box component="span" sx={{ p: .8, bgcolor: visible.includes(m.name) ? '#5cb879' : '#e1e1e1', color: visible.includes(m.name) ? '#fff' : '#555', fontSize: 13 }}>{m.name}</Box><Checkbox size="small" checked={visible.includes(m.name)} onChange={e => setVisible(current => e.target.checked ? [...current, m.name] : current.filter(value => value !== m.name))} slotProps={{ input: { 'aria-label': `Show ${m.name} chart` } }} sx={{ p: .4, color: '#ccc', '&.Mui-checked': { color: '#5cb879' } }} /></Box>)}</Box>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' }, gap: { xs: 1.5, md: 4 }, p: 2 }}>{measurements.map(m => <Button key={m.name} onClick={() => document.getElementById(`health-${m.name.replaceAll(' ', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} disabled={!visible.includes(m.name)} sx={{ bgcolor: m.color, color: '#fff', borderRadius: 1, minHeight: 155, display: 'flex', flexDirection: 'column', gap: 1, '&:hover': { bgcolor: m.color, filter: 'brightness(.95)' }, '&.Mui-disabled': { bgcolor: m.color, color: '#fff', opacity: .6 } }}><Box sx={{ width: 86, height: 86, borderRadius: '50%', border: '2px solid #fff', display: 'grid', placeItems: 'center', bgcolor: 'rgba(0,0,0,.15)' }}><m.icon sx={{ fontSize: 55 }} /></Box><Typography sx={{ fontSize: 14 }}>{m.name}{m.name === 'Blood pressure' ? ' (mmHg)' : m.name === 'Blood Oxygen' ? ' (%)' : ''}</Typography></Button>)}</Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: .5 }}>{measurements.filter(m => visible.includes(m.name)).map(m => <Box key={m.name} id={`health-${m.name.replaceAll(' ', '-')}`}><HealthChartPanel {...m} imei={device.imei ?? device.serial_number} /></Box>)}</Box>
  </Stack>
}
