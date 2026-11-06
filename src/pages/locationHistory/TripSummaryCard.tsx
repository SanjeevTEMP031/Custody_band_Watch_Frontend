import { useEffect, useState } from 'react'
import { Box, Card, CardContent, Chip, Typography, useTheme } from '@mui/material'
import {
  MapPin,
  Flag,
  Navigation,
  Clock,
  Activity,
  CheckCircle2,
  Radio,
} from 'lucide-react'
import type { TripRecord } from '../../lib/firebase'

interface TripSummaryCardProps {
  trip: TripRecord | null
  currentSpeed?: number | null
}

function formatCoords(lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return 'No GPS Fix'
  }
  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lon).toFixed(5)}° ${lonDir}`
}

function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return isoString
  }
}

function formatDuration(startTime?: string | null, endTime?: string | null, nowMs?: number): string {
  if (!startTime) return '0s'
  const start = new Date(startTime).getTime()
  if (isNaN(start)) return '0s'

  const end = endTime ? new Date(endTime).getTime() : (nowMs ?? Date.now())
  const diffSec = Math.max(0, Math.floor((end - start) / 1000))

  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  const seconds = diffSec % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)

  return parts.join(' ')
}

export default function TripSummaryCard({ trip, currentSpeed }: TripSummaryCardProps) {
  const theme = useTheme()
  const [nowMs, setNowMs] = useState<number>(Date.now())

  const isInProgress = trip?.status === 'in_progress'

  // Update timer every second for active in-progress trips
  useEffect(() => {
    if (!isInProgress) return
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [isInProgress])

  if (!trip) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#f8fafc', borderStyle: 'dashed' }}>
        <CardContent sx={{ py: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Select a device and trip or start a new journey to view route details and distance.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const durationStr = formatDuration(trip.start_time, trip.end_time, nowMs)
  const distanceKm = trip.total_distance_km ?? 0
  const distanceDisplay = distanceKm >= 1
    ? `${distanceKm.toFixed(2)} km`
    : `${Math.round(distanceKm * 1000)} m`

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: isInProgress ? 'primary.light' : 'divider',
        bgcolor: '#ffffff',
        overflow: 'hidden',
        boxShadow: isInProgress
          ? '0 4px 20px -2px rgba(37, 99, 235, 0.12)'
          : '0 2px 8px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Top Status Header */}
      <Box
        sx={{
          px: 3,
          py: 1.75,
          bgcolor: isInProgress ? 'rgba(37, 99, 235, 0.04)' : '#f8fafc',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Activity size={18} color={isInProgress ? theme.palette.primary.main : '#64748b'} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1e293b' }}>
            Trip Summary
            {trip.wearer_name ? ` — ${trip.wearer_name}` : ` — Device ${trip.device_id}`}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isInProgress ? (
            <Chip
              icon={<Radio size={14} className="animate-pulse" />}
              label="Trip In Progress"
              color="primary"
              size="small"
              sx={{ fontWeight: 600, px: 0.5 }}
            />
          ) : (
            <Chip
              icon={<CheckCircle2 size={14} />}
              label="Completed"
              size="small"
              sx={{
                fontWeight: 600,
                px: 0.5,
                bgcolor: '#e2e8f0',
                color: '#334155',
              }}
            />
          )}
          <Chip
            label={`${trip.point_count || trip.route_points?.length || 0} GPS Fixes`}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 500, fontSize: 12 }}
          />
        </Box>
      </Box>

      <CardContent sx={{ p: 3 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: '1fr 1fr',
              md: 'repeat(4, 1fr)',
            },
            gap: 2.5,
          }}
        >
          {/* 1. TOTAL DISTANCE TRAVELLED */}
          <Box sx={{ p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Navigation size={16} color="#2563eb" />
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Total Travelled Distance
              </Typography>
            </Box>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#1d4ed8', mt: 1 }}>
              {distanceDisplay}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Point-by-point Haversine calculation
            </Typography>
          </Box>

          {/* 2. DURATION */}
          <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Clock size={16} color="#64748b" />
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Travel Duration
              </Typography>
            </Box>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a', mt: 1 }}>
              {durationStr}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {isInProgress ? 'Live journey elapsed time' : 'Total completed duration'}
            </Typography>
          </Box>

          {/* 3. START LOCATION & TIME */}
          <Box sx={{ p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #bbf7d0', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <MapPin size={16} color="#16a34a" />
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Start Location
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#14532d', mt: 1 }}>
              {formatCoords(trip.start_location?.latitude, trip.start_location?.longitude)}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: '#15803d', mt: 0.5 }}>
              {formatDateTime(trip.start_time)}
            </Typography>
          </Box>

          {/* 4. END LOCATION & TIME */}
          <Box
            sx={{
              p: 2,
              bgcolor: isInProgress ? '#fffbeb' : '#fef2f2',
              borderRadius: 2,
              border: '1px solid',
              borderColor: isInProgress ? '#fde68a' : '#fecaca',
              height: '100%',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Flag size={16} color={isInProgress ? '#d97706' : '#dc2626'} />
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: isInProgress ? '#92400e' : '#991b1b',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {isInProgress ? 'Current Position' : 'End Location'}
              </Typography>
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color: isInProgress ? '#78350f' : '#7f1d1d',
                mt: 1,
              }}
            >
              {isInProgress
                ? formatCoords(trip.current_location?.latitude, trip.current_location?.longitude)
                : formatCoords(trip.end_location?.latitude, trip.end_location?.longitude)}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: isInProgress ? '#b45309' : '#b91c1c',
                mt: 0.5,
              }}
            >
              {isInProgress
                ? (currentSpeed != null ? `Speed: ${currentSpeed} km/h` : 'In Transit')
                : formatDateTime(trip.end_time)}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
