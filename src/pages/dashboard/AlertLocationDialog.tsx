import { useEffect, useState } from 'react'
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import { AlertTriangle, Clock, MapPin, Navigation } from 'lucide-react'
import type { ApiAlert, Device } from '../../services/api'

function formatTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatAge(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${remMinutes}m ago`
}

export default function AlertLocationDialog({
  alert,
  device,
  open,
  onClose,
}: {
  alert: ApiAlert | null
  device: Device | undefined
  open: boolean
  onClose: () => void
}) {
  const [addressText, setAddressText] = useState<string>('')
  const [infoOpen, setInfoOpen] = useState<boolean>(true)
  const [mapType, setMapType] = useState<'m' | 'k'>('m') // 'm' = Roadmap, 'k' = Satellite
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'alert_snapshot' | 'device_current'>('alert_snapshot')

  // Requirement 5: Use strictly the alert's snapshot coordinates.
  // Never blindly substitute the device's current location when viewing historical alerts.
  const alertLat = alert?.latitude
  const alertLon = alert?.longitude
  const hasAlertLocation =
    alertLat != null &&
    alertLon != null &&
    Number.isFinite(alertLat) &&
    Number.isFinite(alertLon) &&
    !(alertLat === 0 && alertLon === 0)

  // Device current live location (maintained as a strictly separate concept)
  const liveLat = device?.last_latitude
  const liveLon = device?.last_longitude
  const hasLiveLocation =
    liveLat != null &&
    liveLon != null &&
    Number.isFinite(liveLat) &&
    Number.isFinite(liveLon) &&
    !(liveLat === 0 && liveLon === 0)

  const activeLat = activeTab === 'alert_snapshot' ? (hasAlertLocation ? alertLat! : 0) : (hasLiveLocation ? liveLat! : 0)
  const activeLon = activeTab === 'alert_snapshot' ? (hasAlertLocation ? alertLon! : 0) : (hasLiveLocation ? liveLon! : 0)
  const currentViewHasCoords = activeTab === 'alert_snapshot' ? hasAlertLocation : hasLiveLocation

  const isStale = Boolean(alert?.location_is_stale || alert?.location_source === 'HISTORICAL')
  const locAgeSeconds = alert?.location_age_seconds
  const locAgeFormatted = formatAge(locAgeSeconds)
  const locSource = alert?.location_source || (hasAlertLocation ? (isStale ? 'HISTORICAL' : 'LIVE') : 'UNAVAILABLE')

  const rawPersonOrDevice =
    (device as any)?.custody_person_name ||
    (device as any)?.wearer_name ||
    (device as any)?.person_name ||
    (alert as any)?.person_name ||
    device?.device_name ||
    alert?.device_name ||
    device?.serial_number ||
    (alert?.device_id ? `Device #${alert.device_id}` : 'N/A')

  const personOrDeviceName = String(rawPersonOrDevice).toLowerCase().includes('demo')
    ? (device?.id ? `Watch #${device.id}` : 'Custody Watch')
    : rawPersonOrDevice

  const imei = device?.imei || alert?.imei || (alert?.device_id ? String(alert.device_id) : 'N/A')
  const batteryPct = (alert as any)?.battery_pct ?? (alert as any)?.battery ?? device?.battery_pct ?? null
  const alertType = alert?.title || alert?.message || alert?.type || 'Security Alert'
  const alertTime = alert?.created_at ? formatTime(alert.created_at) : 'N/A'
  const locTimestamp = alert?.location_timestamp ? formatTime(alert.location_timestamp) : null

  // Reverse geocode to street address
  useEffect(() => {
    if (!open) return
    setInfoOpen(true)

    if (!currentViewHasCoords) {
      setAddressText('Location coordinates unavailable.')
      return
    }

    const defaultCoords = activeLat.toFixed(6) + ', ' + activeLon.toFixed(6)
    setAddressText(defaultCoords)

    const controller = new AbortController()
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${activeLat}&lon=${activeLon}&format=json`,
      { signal: controller.signal }
    )
      .then(res => res.json())
      .then(data => {
        if (data && data.display_name) {
          setAddressText(data.display_name)
        }
      })
      .catch(() => {
        setAddressText(defaultCoords)
      })

    return () => controller.abort()
  }, [open, currentViewHasCoords, activeLat, activeLon])

  const googleMapsEmbedUrl =
    'https://maps.google.com/maps?q=' +
    activeLat +
    ',' +
    activeLon +
    '&t=' +
    mapType +
    '&z=17&ie=UTF8&iwloc=&output=embed'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          },
        },
      }}
    >
      {/* Dialog Header */}
      <DialogTitle
        sx={{
          m: 0,
          p: 2,
          bgcolor: '#071a2e',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <AlertTriangle size={22} color="#f43f5e" />
          <Box>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
              Alert Location &amp; Hardware Snapshot
            </Typography>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
              IMEI: {imei} &bull; {personOrDeviceName}
            </Typography>
          </Box>
        </Box>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            color: '#94a3b8',
            '&:hover': { color: '#ffffff', bgcolor: 'rgba(255, 255, 255, 0.1)' },
          }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, position: 'relative' }}>
        {/* Navigation / Location Mode Bar */}
        <Box
          sx={{
            px: 2.5,
            py: 1.2,
            bgcolor: '#0f2744',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
            borderBottom: '1px solid #1e3a5f',
          }}
        >
          {/* Concept Switcher Tabs */}
          <Stack direction="row" spacing={1}>
            <button
              type="button"
              onClick={() => setActiveTab('alert_snapshot')}
              style={{
                background: activeTab === 'alert_snapshot' ? '#2563eb' : 'transparent',
                color: '#ffffff',
                border: '1px solid ' + (activeTab === 'alert_snapshot' ? '#3b82f6' : '#334155'),
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Clock size={13} />
              Alert Event Snapshot
            </button>

            {hasLiveLocation && (
              <button
                type="button"
                onClick={() => setActiveTab('device_current')}
                style={{
                  background: activeTab === 'device_current' ? '#059669' : 'transparent',
                  color: '#ffffff',
                  border: '1px solid ' + (activeTab === 'device_current' ? '#10b981' : '#334155'),
                  borderRadius: '6px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Navigation size={13} />
                Device Live Location
              </button>
            )}
          </Stack>

          {/* Location Classification Badge */}
          {activeTab === 'alert_snapshot' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {hasAlertLocation ? (
                isStale ? (
                  <Chip
                    label={`Historical Fix (${locAgeFormatted ? locAgeFormatted + ' at event' : 'Historical'})`}
                    size="small"
                    sx={{ bgcolor: '#d97706', color: '#ffffff', fontWeight: 600, fontSize: 11 }}
                  />
                ) : (
                  <Chip
                    label="Fresh GPS Fix (Live at event)"
                    size="small"
                    sx={{ bgcolor: '#059669', color: '#ffffff', fontWeight: 600, fontSize: 11 }}
                  />
                )
              ) : (
                <Chip
                  label="Location Unavailable"
                  size="small"
                  sx={{ bgcolor: '#dc2626', color: '#ffffff', fontWeight: 600, fontSize: 11 }}
                />
              )}
            </Box>
          )}

          {activeTab === 'device_current' && (
            <Chip
              label="Live Hardware Telemetry"
              size="small"
              sx={{ bgcolor: '#059669', color: '#ffffff', fontWeight: 600, fontSize: 11 }}
            />
          )}
        </Box>

        {/* Map Container */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 480,
            bgcolor: '#e2e8f0',
            overflow: 'hidden',
          }}
        >
          {currentViewHasCoords ? (
            <iframe
              key={googleMapsEmbedUrl}
              title={'Location Map for ' + personOrDeviceName}
              src={googleMapsEmbedUrl}
              width="100%"
              height="100%"
              style={{
                border: 0,
                display: 'block',
                width: '100%',
                height: '100%',
              }}
              loading="eager"
              allowFullScreen
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#f8fafc',
                color: '#64748b',
                gap: 1.5,
                p: 3,
                textAlign: 'center',
              }}
            >
              <MapPin size={42} color="#dc2626" />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                Location Unavailable
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 440 }}>
                No verified GPS coordinates were recorded at the moment of this alert.
                The system intentionally preserves forensic integrity without substituting invalid 0,0 coordinates.
              </Typography>
            </Box>
          )}

          {/* Reference Overlay Card */}
          {infoOpen && (
            <div
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25)',
                padding: '14px',
                minWidth: '280px',
                maxWidth: '350px',
                zIndex: 20,
                fontSize: '13px',
                lineHeight: 1.45,
                color: '#0f172a',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: '6px',
                }}
              >
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>
                  {personOrDeviceName}
                </strong>
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  title="Close popup"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    background: '#f8fafc',
                    color: '#64748b',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  &#x2715;
                </button>
              </div>

              <div style={{ marginBottom: '4px' }}>
                <strong>IMEI:</strong> <span style={{ fontFamily: 'monospace' }}>{imei}</span>
              </div>
              <div style={{ marginBottom: '4px' }}>
                <strong>Battery:</strong> {batteryPct != null ? `${batteryPct}%` : '—'}
              </div>
              <div style={{ marginBottom: '4px', color: '#b91c1c' }}>
                <strong>Alarm:</strong> {alertType}
              </div>
              <div style={{ color: '#475569', fontSize: '12px', marginBottom: '4px' }}>
                <strong>Event Time:</strong> {alertTime}
              </div>

              {locTimestamp && (
                <div style={{ color: isStale ? '#b45309' : '#059669', fontSize: '11.5px', marginBottom: '4px' }}>
                  <strong>Fix Timestamp:</strong> {locTimestamp} ({locSource})
                </div>
              )}

              {currentViewHasCoords && (
                <div style={{ color: '#475569', fontSize: '11px', marginBottom: '8px' }}>
                  <strong>Coordinates:</strong> {activeLat.toFixed(6)}, {activeLon.toFixed(6)}
                </div>
              )}

              {/* Map Layer Switcher */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowLayerMenu(!showLayerMenu)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    padding: '3px 9px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <span>{mapType === 'm' ? 'Roadmap' : 'Satellite'}</span>
                  <span style={{ fontSize: '10px' }}>&#x25BE;</span>
                </button>

                {showLayerMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      overflow: 'hidden',
                      zIndex: 30,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMapType('m')
                        setShowLayerMenu(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 14px',
                        background: mapType === 'm' ? '#f1f5f9' : '#ffffff',
                        border: 'none',
                        textAlign: 'left',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Roadmap
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMapType('k')
                        setShowLayerMenu(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 14px',
                        background: mapType === 'k' ? '#f1f5f9' : '#ffffff',
                        border: 'none',
                        textAlign: 'left',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Satellite
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </Box>

        {/* Address Footer Bar */}
        <Box
          sx={{
            p: 2,
            bgcolor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <MapPin size={18} color="#0284c7" />
          <Typography variant="body2" sx={{ color: '#334155', fontSize: 13, flex: 1 }}>
            {addressText || 'Loading location address...'}
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
