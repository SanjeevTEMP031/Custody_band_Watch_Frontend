import { useEffect, useState } from 'react'
import { Box, Button, Checkbox, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { Favorite, MonitorHeart, DirectionsWalk, Bedtime, Thermostat, WaterDrop } from '@mui/icons-material'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Device } from '../../services/api'
import {
  getDeviceHealthSummary,
  getHeartRateHistory,
  type DeviceHealthSummary,
  type HealthReading,
} from '../../services/api'

const measurements = [
  { name: 'Heart rate', title: 'Heart Rate', unit: 'BPM', color: '#2196ff', icon: Favorite },
  { name: 'Blood pressure', title: 'Blood pressure', unit: 'mmHg', color: '#ff5722', icon: MonitorHeart },
  { name: 'Step counter', title: 'Pedometer data', unit: 'Steps', color: '#00998c', icon: DirectionsWalk },
  { name: 'Sleep', title: 'Sleep data', unit: 'Minutes', color: '#ffba00', icon: Bedtime },
  { name: 'Temperature', title: 'Temperature', unit: '°C', color: '#00998c', icon: Thermostat },
  { name: 'Blood Oxygen', title: 'Blood Oxygen', unit: '%', color: '#00998c', icon: WaterDrop },
  { name: 'Blood glucose', title: 'Blood glucose', unit: 'mmol/L', color: '#805ad5', icon: WaterDrop },
  { name: 'HRV', title: 'Heart rate variability', unit: 'ms', color: '#0f766e', icon: MonitorHeart },
]

interface ChartPoint {
  timestamp: string
  label: string
  value: number
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayValue(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(displayValue).filter((entry): entry is string => entry !== null).join(', ') || null
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry != null && entry !== '')
      .map(([key, entry]) => `${key.replaceAll('_', ' ')}: ${displayValue(entry)}`)
      .join(', ') || null
  }
  return null
}

function readingValue(reading: HealthReading, metric: string): number | null {
  if (metric === 'Heart rate') {
    const value = Number(reading.bpm ?? reading.heart_rate)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (metric === 'Blood Oxygen') {
    const value = Number(reading.spo2)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (metric === 'Blood pressure' && reading.blood_pressure) {
    const value = Number(reading.blood_pressure.split('/')[0])
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}

function HealthChartPanel({
  name,
  title,
  unit,
  imei,
  readings,
  latestValue,
}: {
  name: string
  title: string
  unit: string
  imei: string
  readings: HealthReading[]
  latestValue: string | null
}) {
  const [start, setStart] = useState(localDate(new Date()))
  const [end, setEnd] = useState(localDate(new Date()))
  const [range, setRange] = useState(() => ({ start: localDate(new Date()), end: localDate(new Date()) }))
  const [error, setError] = useState('')
  const points: ChartPoint[] = readings
    .filter((reading) => reading.timestamp)
    .map((reading) => {
      const timestamp = reading.timestamp!
      const date = new Date(timestamp)
      return {
        timestamp,
        label: date.toLocaleString(),
        value: readingValue(reading, name),
      }
    })
    .filter((point): point is ChartPoint =>
      point.value !== null &&
      point.timestamp.slice(0, 10) >= range.start &&
      point.timestamp.slice(0, 10) <= range.end
    )
    .sort((first, second) => Date.parse(first.timestamp) - Date.parse(second.timestamp))

  return (
    <Box component="section" aria-label={`${name} chart`} sx={{ border: '1px solid #e3e3e3', minWidth: 0 }}>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!start || !end || start > end) {
            setError('Choose a valid date range.')
            return
          }
          setError('')
          setRange({ start, end })
        }}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', p: 1.25, bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c' }}
      >
        <Typography sx={{ fontSize: 14 }}>{name}</Typography>
        <TextField required type="date" size="small" value={start} onChange={(event) => setStart(event.target.value)} sx={{ width: 170, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: 0 } }} slotProps={{ htmlInput: { 'aria-label': `${name} start date` } }} />
        <TextField required type="date" size="small" value={end} onChange={(event) => setEnd(event.target.value)} sx={{ width: 170, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: 0 } }} slotProps={{ htmlInput: { min: start, 'aria-label': `${name} end date` } }} />
        <Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: 0.3, height: 38 }}>Lookup</Button>
      </Box>
      {error && <Typography role="alert" color="error" sx={{ p: 1 }}>{error}</Typography>}
      <Box sx={{ height: 380, position: 'relative', bgcolor: '#fff', p: 2.5 }}>
        <Typography sx={{ textAlign: 'center', fontSize: 19, color: '#444' }}>{title} — {imei}</Typography>
        <Typography sx={{ textAlign: 'center', color: '#666', fontSize: 13, mt: 1 }}>{range.start} to {range.end}</Typography>
        <Typography sx={{ position: 'absolute', left: 14, top: '50%', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 12, color: '#666' }}>{unit}</Typography>
        <Box sx={{ position: 'absolute', inset: '95px 25px 45px 52px', borderBottom: '1px solid #c5d5f4' }}>
          {points.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" hide />
                <YAxis width={42} />
                <ChartTooltip />
                <Line type="monotone" dataKey="value" stroke="#00998c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'grid', placeContent: 'center', gap: 1, textAlign: 'center' }}>
              {latestValue && <Typography sx={{ color: '#334155', fontWeight: 600 }}>Latest: {latestValue}</Typography>}
              <Typography role="status" sx={{ fontSize: 13, color: '#777', fontWeight: 600 }}>
                {latestValue ? 'The API has no history for this metric.' : 'No readings returned by the API.'}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

export default function HealthDeviceDetail({ device, onBack }: { device: Device; onBack: () => void }) {
  const [visible, setVisible] = useState(['Heart rate', 'Step counter', 'Temperature', 'Blood Oxygen'])
  const [summary, setSummary] = useState<DeviceHealthSummary | null>(null)
  const [readings, setReadings] = useState<HealthReading[]>([])
  const [loading, setLoading] = useState(true)
  const [healthError, setHealthError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setHealthError('')
    Promise.allSettled([
      getDeviceHealthSummary(device.device_id ?? device.imei ?? device.id),
      getHeartRateHistory(device.device_id ?? device.imei ?? device.id, 500),
    ]).then(([summaryResult, historyResult]) => {
      if (!active) return
      const errors: string[] = []
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value)
      else errors.push(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Unable to load health summary.')
      if (historyResult.status === 'fulfilled') setReadings(historyResult.value)
      else errors.push(historyResult.reason instanceof Error ? historyResult.reason.message : 'Unable to load health history.')
      setHealthError(errors.join(' '))
      setLoading(false)
    })
    return () => { active = false }
  }, [device.device_id, device.imei, device.id])

  const info: Array<[string, unknown]> = [
    ['Device Name', device.device_name ?? device.serial_number],
    ['Model', device.device_model],
    ['IMEI', device.imei],
    ['Company', device.company],
    ['SIM', device.device_sim],
    ['Status', device.status],
    ['Last communication', device.last_packet_received ?? device.last_seen],
  ]
  const metricValues: Record<string, unknown> = {
    'Heart rate': device.heart_rate ?? summary?.current_pulse_bpm ?? summary?.heart_rate,
    'Blood pressure': device.blood_pressure ?? summary?.blood_pressure,
    'Step counter': device.step_counter ?? device.steps ?? summary?.today_steps ?? summary?.steps,
    Sleep: device.sleep ?? summary?.sleep,
    Temperature: device.temperature ?? summary?.temperature,
    'Blood Oxygen': device.blood_oxygen ?? summary?.blood_oxygen ?? summary?.spo2,
    'Blood glucose': device.blood_glucose ?? summary?.blood_glucose ?? summary?.glucose_mmol_l,
    HRV: device.hrv ?? summary?.hrv,
  }
  const latestVitals = Object.entries(metricValues)
    .map(([label, value]) => [label, displayValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
  const telemetryDetails: Array<[string, unknown]> = [
    ['Battery', device.battery_pct != null ? `${device.battery_pct}%` : null],
    ['Battery status', device.battery_status],
    ['Charging', device.is_charging ?? device.charging],
    ['Connection', device.connection_status ?? device.status],
    ['TCP connected', device.tcp_connected],
    ['GPS status', device.gps_status],
    ['GPS source', device.gps_source ?? device.gps_fix_source],
    ['GPS fix time', device.gps_update_time ?? device.last_valid_gps_time],
    ['Last packet', device.last_packet_received ?? device.last_seen],
    ['Latitude', device.last_latitude ?? device.latitude],
    ['Longitude', device.last_longitude ?? device.longitude],
    ['Speed', device.speed_kmh != null ? `${device.speed_kmh} km/h` : null],
    ['Direction', device.direction_deg ?? device.heading],
    ['Satellites', device.satellites],
    ['Signal', device.signal_percent ?? device.gsm_signal],
    ['Altitude', device.altitude_m],
    ['Mileage', device.mileage_km],
    ['Rolls', device.rolls],
    ['Alarms', device.alarms],
    ['Cell MCC/MNC', device.cell_mcc != null || device.cell_mnc != null ? `${device.cell_mcc ?? '—'}/${device.cell_mnc ?? '—'}` : null],
    ['Cell data', device.cells],
    ['Wi-Fi', device.wifi],
    ['Nearby Wi-Fi', device.nearby_wifi_count],
    ['Sleep report', device.sleep_report ?? summary?.sleep_report],
    ['Sleep (all day)', device.sleep_allday ?? summary?.sleep_allday],
  ]
    .map(([label, value]) => [label, displayValue(value)] as [string, string | null])
    .filter((entry): entry is [string, string] => entry[1] !== null)

  return (
    <Stack spacing={1.5} sx={{ bgcolor: '#fff' }}>
      <Box><Button onClick={onBack}>Back to Health Data</Button></Box>
      {healthError && <Typography role="alert" color="error">{healthError}</Typography>}
      <Box sx={{ bgcolor: '#f2f2f2', p: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
          {info.map(([label, value]) => (
            <Box key={label} sx={{ display: 'flex', minWidth: 0, border: '1px solid #e3e3e3' }}>
              <Typography sx={{ width: 130, flexShrink: 0, p: 1.5, bgcolor: '#e7e7e7', textAlign: 'center', fontSize: 14 }}>{label}</Typography>
              <Typography sx={{ bgcolor: '#fff', flex: 1, p: 1.5, overflowWrap: 'anywhere', fontSize: 14 }}>{displayValue(value) ?? '—'}</Typography>
            </Box>
          ))}
        </Box>
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>}
        {summary && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {[
            ['Average heart rate', summary.average_bpm],
            ['Maximum heart rate', summary.max_bpm],
            ['Minimum heart rate', summary.min_bpm],
            ['Readings', readings.length],
          ].map(([label, value]) => value != null && (
            <Box key={label} sx={{ bgcolor: '#fff', border: '1px solid #e3e3e3', px: 1.5, py: 1 }}>
              <Typography sx={{ color: '#666', fontSize: 12 }}>{label}</Typography>
              <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{displayValue(value) ?? '—'}</Typography>
            </Box>
          ))}
        </Box>}
        {latestVitals.length > 0 && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {latestVitals.map(([label, value]) => (
            <Box key={label} sx={{ bgcolor: '#fff', border: '1px solid #e3e3e3', px: 1.5, py: 1 }}>
              <Typography sx={{ color: '#666', fontSize: 12 }}>{label}</Typography>
              <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{value}</Typography>
            </Box>
          ))}
        </Box>}
        {telemetryDetails.length > 0 && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 0.5, mt: 1 }}>
          {telemetryDetails.map(([label, value]) => (
            <Box key={label} sx={{ display: 'flex', border: '1px solid #e3e3e3', bgcolor: '#fff' }}>
              <Typography sx={{ color: '#666', p: 1, fontSize: 12, flex: 1 }}>{label}</Typography>
              <Typography sx={{ fontWeight: 600, p: 1, fontSize: 12, overflowWrap: 'anywhere' }}>{displayValue(value) ?? '—'}</Typography>
            </Box>
          ))}
        </Box>}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, bgcolor: '#fff', p: 1, mt: 1 }}>
          <Typography sx={{ width: 100, fontSize: 14 }}>Health Data</Typography>
          {measurements.map((measurement) => (
            <Box component="label" key={measurement.name} sx={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', cursor: 'pointer' }}>
              <Box component="span" sx={{ p: 0.8, bgcolor: visible.includes(measurement.name) ? '#5cb879' : '#e1e1e1', color: visible.includes(measurement.name) ? '#fff' : '#555', fontSize: 13 }}>{measurement.name}</Box>
              <Checkbox size="small" checked={visible.includes(measurement.name)} onChange={(event) => setVisible((current) => event.target.checked ? [...current, measurement.name] : current.filter((value) => value !== measurement.name))} slotProps={{ input: { 'aria-label': `Show ${measurement.name} chart` } }} sx={{ p: 0.4, color: '#ccc', '&.Mui-checked': { color: '#5cb879' } }} />
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5, p: 2 }}>
        {measurements.map((measurement) => (
          <Button
            key={measurement.name}
            onClick={() => document.getElementById(`health-${measurement.name.replaceAll(' ', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            disabled={!visible.includes(measurement.name)}
            sx={{ bgcolor: measurement.color, color: '#fff', borderRadius: 1, minHeight: 125, display: 'flex', flexDirection: 'column', gap: 1, '&:hover': { bgcolor: measurement.color, filter: 'brightness(.95)' }, '&.Mui-disabled': { bgcolor: measurement.color, color: '#fff', opacity: 0.6 } }}
          >
            <Box sx={{ width: 68, height: 68, borderRadius: '50%', border: '2px solid #fff', display: 'grid', placeItems: 'center', bgcolor: 'rgba(0,0,0,.15)' }}>
              <measurement.icon sx={{ fontSize: 44 }} />
            </Box>
            <Typography sx={{ fontSize: 14 }}>{measurement.name}</Typography>
          </Button>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 0.5 }}>
        {measurements.filter((measurement) => visible.includes(measurement.name)).map((measurement) => (
          <Box key={measurement.name} id={`health-${measurement.name.replaceAll(' ', '-')}`}>
            <HealthChartPanel
              {...measurement}
              imei={device.imei ?? device.serial_number}
              readings={readings}
              latestValue={displayValue(metricValues[measurement.name])}
            />
          </Box>
        ))}
      </Box>
    </Stack>
  )
}
