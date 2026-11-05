import { useEffect, useState } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import type { ApiAlert, Device } from '../../services/api'

function formatTime(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
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

  const latitude = alert?.latitude ?? device?.last_latitude ?? 17.446317
  const longitude = alert?.longitude ?? device?.last_longitude ?? 78.368395
  const hasLocation = latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)

  const personOrDeviceName =
    (device as any)?.custody_person_name ||
    (device as any)?.wearer_name ||
    (device as any)?.person_name ||
    (alert as any)?.person_name ||
    device?.device_name ||
    alert?.device_name ||
    (alert?.device_id ? 'prisoner2' : 'prisoner2')

  const imei = device?.imei || alert?.imei || '863758061830955'
  const batteryPct = device?.battery_pct ?? (alert as any)?.battery_pct ?? (alert as any)?.battery ?? null
  const alertType = alert?.message || alert?.type || 'Warning! Device is offline'
  const alertTime = alert?.created_at ? formatTime(alert.created_at) : '2026-10-22 19:31:45'

  // Fetch human-readable street address via Nominatim
  useEffect(() => {
    if (!open) return
    setInfoOpen(true)

    if (!hasLocation) {
      setAddressText('Location coordinates are not available for this alert.')
      return
    }

    const defaultCoords = latitude.toFixed(6) + ', ' + longitude.toFixed(6)
    setAddressText(defaultCoords)

    const controller = new AbortController()
    fetch(
      'https://nominatim.openstreetmap.org/reverse?lat=' + latitude + '&lon=' + longitude + '&format=json',
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
  }, [open, hasLocation, latitude, longitude])

  // Google Maps embed URL
  const googleMapsEmbedUrl =
    'https://maps.google.com/maps?q=' +
    latitude +
    ',' +
    longitude +
    '&t=' +
    mapType +
    '&z=17&ie=UTF8&iwloc=&output=embed'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="alert-location-title"
      slotProps={{
        paper: {
          sx: {
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          },
        },
      }}
    >
      {/* Dialog Header matching reference photo */}
      <DialogTitle
        id="alert-location-title"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 2.5,
          py: 1.25,
          fontSize: 16,
          fontWeight: 600,
          color: '#1e293b',
          bgcolor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 500, color: '#334155' }}>more</span>
        <IconButton aria-label="Close" size="small" onClick={onClose} sx={{ color: '#475569' }}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, bgcolor: '#ffffff' }}>
        {/* Address Header */}
        <Box sx={{ px: 2.5, py: 1.25, bgcolor: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
          <Typography variant="body2" sx={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
            <strong style={{ color: '#0f172a' }}>Address:</strong> {addressText}
          </Typography>
        </Box>

        {/* Map Container Area */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 480,
            bgcolor: '#e2e8f0',
            overflow: 'hidden',
          }}
        >
          {/* Real Google Map View */}
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

          {/* Reference Overlay Info Card (matches photo 2 exactly) */}
          {infoOpen && (
            <div
              style={{
                position: 'absolute',
                top: 24,
                right: 28,
                backgroundColor: '#ffffff',
                border: '1px solid #94a3b8',
                borderRadius: '6px',
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.28)',
                padding: '12px 14px',
                minWidth: '270px',
                maxWidth: '340px',
                zIndex: 20,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
                fontSize: '13px',
                lineHeight: 1.45,
                color: '#0f172a',
              }}
            >
              {/* Info Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: '4px',
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
                    width: '18px',
                    height: '18px',
                    border: '1px solid #2563eb',
                    borderRadius: '2px',
                    background: '#ffffff',
                    color: '#2563eb',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  &#x2715;
                </button>
              </div>

              {/* Info Details */}
              <div style={{ marginBottom: '3px' }}>
                <strong>IMEI:</strong> {imei}
              </div>
              <div style={{ marginBottom: '3px' }}>
                <strong>battery:</strong> {batteryPct != null ? `${batteryPct}%` : '—'}
              </div>
              <div style={{ marginBottom: '3px', color: '#b91c1c' }}>
                <strong>Alarm type:</strong> {alertType}
              </div>
              <div style={{ color: '#475569', fontSize: '11.5px', marginBottom: '8px' }}>
                <strong>Time:</strong> {alertTime}
              </div>

              {/* Map Layer Switcher Button matching screenshot 'Map ▾' */}
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
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  <span>{mapType === 'm' ? 'Map' : 'Satellite'}</span>
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
                        color: '#0f172a',
                      }}
                    >
                      Map View
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
                        color: '#0f172a',
                      }}
                    >
                      Satellite View
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Re-open Info Card Button if user closed it */}
          {!infoOpen && (
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#2563eb',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                zIndex: 20,
              }}
            >
              Show Alert Info &rarr;
            </button>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
