/**
 * DashboardLiveMap.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Live GPS tracking map for the Trackin360 / Custody Watch platform.
 *
 * Features:
 *  • Blue circular marker at current device position (with pulse ring)
 *  • Blue route loaded from valid GPS history for the selected device
 *  • Selected device GPS is polled every 3 s without overlapping requests
 *  • Movement threshold, timestamp ordering, and gap checks suppress jitter
 *  • Route is retained when stationary and can be hidden without stopping tracking
 *  • Stale GPS shown with grey marker + yellow warning badge — never hidden
 *  • Marker updates only to actual reported coordinates
 *  • No hardcoded coordinates or auto-pan after first fit
 *
 * C05 GPS fix validity rules (MNYD protocol):
 * Accept: status is not 'V', valid coordinates, gps_fix = true
 *  Reject : status = 'V', lat = 0 / lon = 0, gps_fix = false
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Maximize2, Minimize2, Radio, Compass, Eye, EyeOff } from 'lucide-react'
import {
  getLatestGpsSnapshot,
  type Device,
  type GpsLocation,
} from '../../services/api'
import {
  isFreshGpsTimestamp,
  normalizeVerifiedGpsFix,
  selectNewestLastReportedGpsLocation,
  type LastReportedGpsLocation,
} from '../../services/gpsNormalization'
import { isValidGpsCoord } from '../../lib/firebase'
import { Link } from 'react-router-dom'
import {
  SELECTED_GPS_POLL_INTERVAL_MS,
  useSelectedGpsRoute,
  type SelectedGpsRouteStatus,
} from './useSelectedGpsRoute'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardLiveMapProps {
  devices: Device[]
  onSelectDevice?: (device: Device) => void
  selectedDeviceId?: number | string | null
}

/**
 * Per-device state kept in a ref (not React state) to avoid re-renders
 * on every GPS poll while still mutating Leaflet objects in-place.
 */
interface MarkerEntry {
  device: Device
  /** The blue location marker */
  marker: L.Marker
  /** Current confirmed position */
  currentLat: number
  currentLng: number
  latestFixAt: number | null
}

interface LastReportedMarkerEntry {
  device: Device
  marker: L.CircleMarker
  location: LastReportedGpsLocation
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GPS_FRESHNESS_MS = 300_000

/** Poll the backend for the latest GPS fix this often (milliseconds). */
const POLL_INTERVAL_MS = 10_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the GPS coordinates represent a real, valid fix.
 * Rejects: (0,0), NaN, Infinity, and coordinates identical to the
 * device-not-found sentinel (0.000000 N / 0.000000 E).
 */
function isAcceptableFix(lat: number, lng: number): boolean {
  return isValidGpsCoord(lat, lng) && !(lat === 0 && lng === 0)
}

function timestampMillis(timestamp: unknown): number | null {
  if (timestamp == null || timestamp === '') return null
  if (typeof timestamp === 'object') {
    const timestampValue = timestamp as { seconds?: unknown; toDate?: () => Date }
    if (typeof timestampValue.toDate === 'function') {
      const value = timestampValue.toDate().getTime()
      return Number.isFinite(value) ? value : null
    }
    if (typeof timestampValue.seconds === 'number') return timestampValue.seconds * 1000
  }
  const numericTimestamp = Number(timestamp)
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1000 : numericTimestamp
  }
  const text = String(timestamp).trim()
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`
  const parsed = Date.parse(withTimezone)
  return Number.isFinite(parsed) ? parsed : null
}

function isStaleGps(timestamp: number | null, now = Date.now()): boolean {
  return timestamp !== null && now - timestamp > GPS_FRESHNESS_MS
}

// ─── Icon factory ─────────────────────────────────────────────────────────────

/**
 * Creates a custom GPS marker icon.
 *
 * Live / selected  → blue circle with pulse ring
 * Online (not sel) → green circle
 * Stale GPS        → grey circle + ⚠ badge in name pill
 */
function createDeviceIcon(options: {
  isOnline: boolean
  isSelected: boolean
  isStale: boolean
  heading?: number | null
  deviceName?: string | null
}): L.DivIcon {
  const { isOnline, isSelected, isStale, heading, deviceName } = options

  const coreColor = isStale
    ? '#94a3b8'
    : isSelected
      ? '#2563eb'
      : isOnline
        ? '#10b981'
        : '#64748b'
  const ringColor = isStale
    ? '#64748b'
    : isSelected
      ? '#1d4ed8'
      : isOnline
        ? '#059669'
        : '#475569'
  const scale = isSelected ? 'scale(1.18)' : 'scale(1)'

  const hasHeading = heading != null && Number.isFinite(heading) && heading >= 0
  const rotation = hasHeading ? heading : 0

  const innerGraphic = hasHeading
    ? `<div style="transform:rotate(${rotation}deg);font-size:11px;line-height:1;font-weight:900;color:#ffffff;">▲</div>`
    : `<div style="width:8px;height:8px;border-radius:50%;background:#ffffff;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`

  const staleBadge = isStale
    ? ` <span style="color:#fbbf24;">⚠ Last Known</span>`
    : ''

  const namePill = deviceName
    ? `<div class="marker-name-pill" style="
        position:absolute;top:-24px;left:50%;transform:translateX(-50%);
        background:rgba(15,23,42,0.90);color:#ffffff;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;
        white-space:nowrap;pointer-events:none;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.22);
      ">${deviceName}${staleBadge}</div>`
    : ''

  // Pulse ring — only shown for live, selected device
  const pulseRing =
    isSelected && !isStale
      ? `<div style="
          position:absolute;inset:-8px;border-radius:50%;
          border:2px solid ${ringColor};opacity:0.4;
          animation:gpsPulse 2s ease-out infinite;
        "></div>`
      : ''

  return L.divIcon({
    className: 'custom-gps-pin',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -22],
    html: `
      <div class="pin-wrapper" style="
        position:relative;width:36px;height:36px;
        display:flex;align-items:center;justify-content:center;
        transform:${scale};
      ">
        ${namePill}
        ${pulseRing}
        <div style="
          width:24px;height:24px;border-radius:50%;
          background:${coreColor};border:2.5px solid #ffffff;
          box-shadow:0 4px 14px rgba(0,0,0,0.35),0 0 0 2px ${ringColor};
          display:flex;align-items:center;justify-content:center;
          position:relative;z-index:2;
        ">${innerGraphic}</div>
      </div>
    `,
  })
}

// ─── Popup factory ────────────────────────────────────────────────────────────

/**
 * Builds the HTML string for the Leaflet popup.
 * Accepts an optional override for speed/battery/heading from the latest GPS poll.
 */
function createPopupHtml(
  device: Device,
  lat: number,
  lng: number,
  overrides?: Partial<GpsLocation>
): string {
  const d = device as any
  const isOnline =
    d.online === true ||
    d.is_online === true ||
    d.is_active === true ||
    String(device.status || d.connection_status || '').toLowerCase() === 'online' ||
    String(device.status || '').toLowerCase() === 'active'

  const recordedAt =
    overrides?.recorded_at ??
    device.gps_update_time ??
    null
  const fixTimestamp = timestampMillis(recordedAt)
  const isStale = isStaleGps(fixTimestamp)
  const lastCommunicationTimestamp = timestampMillis(device.last_seen)

  const speed = overrides?.speed_kmh ?? d.speed_kmh ?? d.speed ?? null
  const heading = overrides?.heading ?? d.heading ?? null
  const battery =
    overrides?.battery_pct ??
    device.battery_pct ??
    d.battery_percent ??
    d.battery ??
    null
  const gpsTimeStr = fixTimestamp !== null ? new Date(fixTimestamp).toLocaleString() : '—'
  const lastCommunicationStr = lastCommunicationTimestamp !== null
    ? new Date(lastCommunicationTimestamp).toLocaleString()
    : '—'

  const rawName = device.device_name || d.wearer_name || device.serial_number || `Watch #${device.id}`
  const wearer = String(rawName).toLowerCase().includes('demo') ? `Watch #${device.id}` : rawName

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.4;min-width:230px;padding:4px;">
      ${isStale ? `<div style="background:#fef9c3;border:1px solid #fbbf24;border-radius:6px;padding:5px 8px;margin-bottom:7px;font-size:10px;color:#92400e;font-weight:600;">
        ⚠ Stale GPS — the last valid fix is older than five minutes.
      </div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:5px;">
        <strong style="color:#0f172a;font-size:14px;">${wearer}</strong>
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px;background:${isOnline ? '#dcfce7' : '#f1f5f9'};color:${isOnline ? '#15803d' : '#64748b'};">
          ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>IMEI:</strong> ${device.imei || device.serial_number || 'N/A'}</div>
      <div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>Battery:</strong> <span style="font-weight:600;color:${battery != null && battery <= 20 ? '#dc2626' : '#16a34a'};">${battery != null ? `${battery}%` : 'N/A'}</span></div>
      ${speed != null && speed > 0 ? `<div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>Speed:</strong> ${Number(speed).toFixed(1)} km/h</div>` : ''}
      ${heading != null && heading >= 0 ? `<div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>Heading:</strong> ${Math.round(Number(heading))}°</div>` : ''}
      <div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>GPS Status:</strong> <span style="font-weight:600;color:${isStale ? '#d97706' : '#16a34a'};">${isStale ? '🟡 Last Known Location' : fixTimestamp !== null ? '🟢 Live GPS Fix' : '⚪ No Verified GPS Location'}</span></div>
      <div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>Location:</strong> ${isStale ? 'Last Known Location' : 'Live GPS Fix'}</div>
      <div style="color:#64748b;font-size:10px;margin-bottom:3px;"><strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <div style="color:#64748b;font-size:10px;margin-bottom:3px;"><strong>GPS fix time:</strong> ${gpsTimeStr}</div>
      <div style="color:#64748b;font-size:10px;margin-bottom:8px;"><strong>Last communication:</strong> ${lastCommunicationStr}</div>
      <a href="/admin/journeys?device=${device.id}" style="display:block;text-align:center;background:#2563eb;color:#ffffff;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:4px;">
        View Live Route &amp; Journey →
      </a>
      <a href="/admin/monitoring-center?device=${device.id}" style="display:block;text-align:center;background:#f1f5f9;color:#334155;text-decoration:none;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:600;">
        Open Monitoring Center →
      </a>
    </div>
  `
}

function createLastReportedPopup(device: Device, location: LastReportedGpsLocation): HTMLElement {
  const popup = document.createElement('div')
  popup.style.cssText = 'font-family:Arial,sans-serif;font-size:12px;line-height:1.5;min-width:210px;'
  const title = document.createElement('strong')
  title.textContent = `Last Reported Location — Unverified${location.isStale ? ' (Stale)' : ''}`
  title.style.color = '#92400e'
  popup.append(title)

  const rows: Array<[string, string]> = [
    ['Device ID', String(device.device_id || device.imei || device.serial_number || device.id)],
    ['Latitude', location.latitude.toFixed(6)],
    ['Longitude', location.longitude.toFixed(6)],
    ['Location timestamp', location.recordedAt
      ? new Date(location.recordedAt).toLocaleString()
      : 'Timestamp unavailable'],
    ['GPS status', String(device.gps_status || 'No Fix')],
    ['Location type', 'Historical / Unverified'],
  ]
  if (location.source) rows.push(['Reported source', location.source])

  rows.forEach(([label, value]) => {
    const row = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = `${label}: `
    const text = document.createElement('span')
    text.textContent = value
    row.append(name, text)
    popup.append(row)
  })
  return popup
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardLiveMap({
  devices,
  onSelectDevice,
  selectedDeviceId,
}: DashboardLiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerGroupRef = useRef<L.LayerGroup | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const markersMapRef = useRef<Map<string, MarkerEntry>>(new Map())
  const lastReportedMarkersRef = useRef<Map<string, LastReportedMarkerEntry>>(new Map())
  const lastCenteredSelectionRef = useRef<string | null>(null)
  const hasInitialFittedRef = useRef<boolean>(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const devicesRef = useRef(devices)
  const onSelectDeviceRef = useRef(onSelectDevice)

  const [mapStyle, setMapStyle] = useState<'standard' | 'humanitarian' | 'voyager'>('standard')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTrailVisible, setIsTrailVisible] = useState(true)
  const [mapForTracking, setMapForTracking] = useState<L.Map | null>(null)
  const [gpsRouteStatus, setGpsRouteStatus] = useState<SelectedGpsRouteStatus>('loading')
  const [apiVerifiedMarkerIds, setApiVerifiedMarkerIds] = useState<Set<string>>(() => new Set())
  const [apiLastReportedLocations, setApiLastReportedLocations] = useState<
    Map<string, LastReportedGpsLocation>
  >(() => new Map())
  const [apiCurrentGpsDeviceIds, setApiCurrentGpsDeviceIds] = useState<Set<string>>(
    () => new Set()
  )
  const [selectedGpsTimestamp, setSelectedGpsTimestamp] = useState<{
    deviceKey: string
    timestamp: number
  } | null>(null)

  // Map tile providers
  const mapTileProviders = {
    standard: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    humanitarian: {
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors, HOT',
    },
    voyager: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  }

  // Show verified last-known fixes too; stale markers are styled separately.
  const locatedDevices = devices.filter((device) => {
    return normalizeVerifiedGpsFix(device) !== null
  })
  const deviceIdsKey = devices.map((device) => device.id).join(',')
  const apiOnlyVerifiedMarkerCount = [...apiVerifiedMarkerIds].filter((id) =>
    !locatedDevices.some((device) => String(device.id) === id)
  ).length
  const verifiedMarkerCount = locatedDevices.length + apiOnlyVerifiedMarkerCount
  const lastReportedLocations = useMemo(() => devices.flatMap((device) => {
    const key = String(device.id)
    if (apiCurrentGpsDeviceIds.has(key)) return []
    const verifiedFix = normalizeVerifiedGpsFix(device)
    if (verifiedFix && isFreshGpsTimestamp(verifiedFix.timestamp)) return []

    const location = selectNewestLastReportedGpsLocation([
      device.gps_last_fix,
      device.gps_last_known_location,
      apiLastReportedLocations.get(key) ?? null,
    ])
    if (!location) return []
    if (
      verifiedFix &&
      verifiedFix.latitude === location.latitude &&
      verifiedFix.longitude === location.longitude
    ) return []
    return [{ device, location }]
  }), [devices, apiCurrentGpsDeviceIds, apiLastReportedLocations])
  const lastReportedMarkerCount = lastReportedLocations.length

  const selectedDevice = devices.find(
    (device) =>
      String(device.id) === String(selectedDeviceId) ||
      String(device.device_id) === String(selectedDeviceId)
  )
  const trackingDeviceId = selectedDevice
    ? String(selectedDevice.device_id || selectedDevice.imei || selectedDevice.serial_number || selectedDevice.id)
    : null
  const firestoreLatest = useMemo<GpsLocation | null>(() => {
    if (!selectedDevice) return null
    const fix = normalizeVerifiedGpsFix(selectedDevice)
    if (!fix) return null
    return {
      device_id: trackingDeviceId ?? undefined,
      latitude: fix.latitude,
      longitude: fix.longitude,
      recorded_at: fix.recordedAt,
      gps_fix: true,
      gps_valid: true,
      gps_source: fix.source,
      gps_status: fix.status,
      status: fix.status,
    }
  }, [selectedDevice, trackingDeviceId])
  const selectedMarkerKey = String(selectedDevice?.id ?? selectedDeviceId ?? '')
  const previousSelectedMarkerKeyRef = useRef<string | null>(null)
  const selectedLastReported = lastReportedLocations.find(({ device }) =>
    String(device.id) === selectedMarkerKey || String(device.device_id) === selectedMarkerKey
  )?.location ?? null
  const selectedFixTimestamp = selectedGpsTimestamp?.deviceKey === selectedMarkerKey
    ? selectedGpsTimestamp.timestamp
    : normalizeVerifiedGpsFix(selectedDevice)?.timestamp ?? null
  const selectedHasVerifiedPosition = Boolean(selectedDevice && selectedFixTimestamp !== null)
  const selectedMarkerIsLastKnown = Boolean(
    (selectedFixTimestamp !== null && isStaleGps(selectedFixTimestamp)) ||
    selectedLastReported
  )

  useEffect(() => {
    const previousKey = previousSelectedMarkerKeyRef.current
    if (previousKey && previousKey !== selectedMarkerKey) {
      setApiCurrentGpsDeviceIds((current) => {
        const next = new Set(current)
        next.delete(previousKey)
        return next
      })
    }
    previousSelectedMarkerKeyRef.current = selectedDeviceId == null ? null : selectedMarkerKey
  }, [selectedDeviceId, selectedMarkerKey])

  useEffect(() => {
    devicesRef.current = devices
  }, [devices])
  useEffect(() => {
    onSelectDeviceRef.current = onSelectDevice
  }, [onSelectDevice])

  const handleVerifiedGpsPoint = useCallback((point: GpsLocation) => {
    if (selectedDeviceId == null) return
    const markerKey = String(selectedDevice?.id ?? selectedDeviceId)
    const fix = normalizeVerifiedGpsFix(point)
    if (!fix) return
    const { latitude, longitude, timestamp } = fix
    const isStale = isStaleGps(timestamp)
    let entry = markersMapRef.current.get(markerKey)
    if (!entry) {
      const map = mapInstanceRef.current
      const markerGroup = markerGroupRef.current
      if (!map || !markerGroup || !selectedDevice) return
      const device = {
        ...selectedDevice,
        last_latitude: latitude,
        last_longitude: longitude,
        gps_update_time: new Date(timestamp).toISOString(),
        gps_fix_source: fix.source,
        has_gps_fix: true,
        gps_fix: true,
      }
      const marker = L.marker([latitude, longitude], {
        icon: createDeviceIcon({
          isOnline: device.online === true || device.is_online === true,
          isSelected: true,
          isStale,
          heading: point.heading ?? device.heading,
          deviceName: device.device_name || `Watch #${device.id}`,
        }),
        zIndexOffset: 1200,
      })
      marker.bindPopup(createPopupHtml(device, latitude, longitude, point), { maxWidth: 280 })
      marker.on('click', () => onSelectDevice?.(selectedDevice))
      marker.addTo(markerGroup)
      entry = {
        device,
        marker,
        currentLat: latitude,
        currentLng: longitude,
        latestFixAt: null,
      }
      markersMapRef.current.set(markerKey, entry)
      setApiVerifiedMarkerIds((current) => new Set(current).add(markerKey))
    }
    if (entry.latestFixAt !== null && timestamp <= entry.latestFixAt) {
      setSelectedGpsTimestamp({ deviceKey: markerKey, timestamp: entry.latestFixAt })
      return
    }

    entry.currentLat = latitude
    entry.currentLng = longitude
    entry.latestFixAt = timestamp
    entry.device = {
      ...entry.device,
      last_latitude: latitude,
      last_longitude: longitude,
      gps_update_time: new Date(timestamp).toISOString(),
      gps_fix_source: fix.source,
      has_gps_fix: true,
      gps_fix: true,
      ...(point.speed_kmh != null ? { speed_kmh: Number(point.speed_kmh) } : {}),
      ...(point.heading != null ? { heading: Number(point.heading) } : {}),
      ...(point.battery_pct != null ? { battery_pct: Number(point.battery_pct) } : {}),
    }
    const markerElement = entry.marker.getElement()
    markerElement?.classList.add('gps-marker-moving')
    entry.marker.setLatLng([latitude, longitude])
    if (markerElement) {
      window.setTimeout(() => markerElement.classList.remove('gps-marker-moving'), 750)
    }
    entry.marker.setIcon(createDeviceIcon({
      isOnline: entry.device.online === true || entry.device.is_online === true,
      isSelected: true,
      isStale,
      heading: point.heading ?? entry.device.heading,
      deviceName: entry.device.device_name || `Watch #${entry.device.id}`,
    }))
    entry.marker.setPopupContent(
      createPopupHtml(entry.device, latitude, longitude, point)
    )
    setSelectedGpsTimestamp({ deviceKey: markerKey, timestamp })
    setApiVerifiedMarkerIds((current) => new Set(current).add(markerKey))
  }, [onSelectDevice, selectedDevice, selectedDeviceId])

  const handleLastReportedLocation = useCallback((
    location: LastReportedGpsLocation | null,
    currentGpsAvailable: boolean
  ) => {
    const markerKey = String(selectedDevice?.id ?? selectedDeviceId ?? '')
    if (!markerKey) return
    setApiCurrentGpsDeviceIds((current) => {
      const next = new Set(current)
      if (currentGpsAvailable) next.add(markerKey)
      else next.delete(markerKey)
      return next
    })
    setApiLastReportedLocations((current) => {
      if (!location && !currentGpsAvailable) return current
      const next = new Map(current)
      if (location) next.set(markerKey, location)
      else next.delete(markerKey)
      return next
    })
  }, [selectedDevice, selectedDeviceId])

  useSelectedGpsRoute(
    mapForTracking,
    trackingDeviceId,
    isTrailVisible,
    handleVerifiedGpsPoint,
    undefined,
    setGpsRouteStatus,
    mapForTracking !== null,
    firestoreLatest,
    selectedDevice?.gps_last_fix,
    handleVerifiedGpsPoint,
    handleLastReportedLocation
  )

  // ── Effect 1: Initialise Leaflet map (runs ONCE) ──────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return

    const markersMap = markersMapRef.current
    const lastReportedMarkers = lastReportedMarkersRef.current
    const firstLocated = locatedDevices[0]
    const firstLastReported = lastReportedLocations[0]?.location
    const initialCenter: [number, number] = firstLocated
      ? [
          Number(firstLocated.last_latitude ?? (firstLocated as any).latitude),
          Number(firstLocated.last_longitude ?? (firstLocated as any).longitude),
        ]
      : firstLastReported
        ? [firstLastReported.latitude, firstLastReported.longitude]
        : [20.5937, 78.9629] // India centre as fallback
    const initialZoom = firstLocated || firstLastReported ? 15 : 4

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const initialTiles = L.tileLayer(mapTileProviders[mapStyle].url, {
      maxZoom: 19,
      attribution: mapTileProviders[mapStyle].attribution,
      crossOrigin: '',
    }).addTo(map)

    const markers = L.layerGroup().addTo(map)

    mapInstanceRef.current = map
    markerGroupRef.current = markers
    tileLayerRef.current = initialTiles
    setMapForTracking(map)

    // Force size recalculation after first paint (flex container height resolves late)
    const sizeTimer = setTimeout(() => map.invalidateSize({ pan: false }), 150)

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
    })
    resizeObserver.observe(mapContainerRef.current)

    return () => {
      clearTimeout(sizeTimer)
      resizeObserver.disconnect()
      markersMap.clear()
      lastReportedMarkers.clear()
      map.remove()
      mapInstanceRef.current = null
      markerGroupRef.current = null
      tileLayerRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: Switch tile layer style ────────────────────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current) return
    tileLayerRef.current?.remove()
    const provider = mapTileProviders[mapStyle]
    tileLayerRef.current = L.tileLayer(provider.url, {
      maxZoom: 19,
      attribution: provider.attribution,
      crossOrigin: '',
    }).addTo(mapInstanceRef.current)
  }, [mapStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: Sync markers from device list ───────────────────────────────
  // Runs whenever the devices prop changes (Firestore real-time push).
  // Creates new markers; updates icons/popups; never moves marker from jitter.
  useEffect(() => {
    const map = mapInstanceRef.current
    const markersGroup = markerGroupRef.current
    if (!map || !markersGroup) return

    const currentDeviceKeys = new Set(devices.map((device) => String(device.id)))
    const locatedDeviceKeys = new Set<string>()
    const bounds: [number, number][] = []

    locatedDevices.forEach((device) => {
      const key = String(device.id)
      locatedDeviceKeys.add(key)

      const verifiedFix = normalizeVerifiedGpsFix(device)
      if (!verifiedFix) return
      const lat = verifiedFix.latitude
      const lng = verifiedFix.longitude
      bounds.push([lat, lng])

      const isSelected =
        String(selectedDeviceId) === key || String(selectedDeviceId) === String(device.device_id)
      const isOnline =
        (device as any).online === true ||
        (device as any).is_online === true ||
        (device as any).is_active === true ||
        String(device.status || (device as any).connection_status || '').toLowerCase() === 'online' ||
        String(device.status || '').toLowerCase() === 'active'
      const rawName = device.device_name || (device as any).wearer_name || `Watch #${device.id}`
      const deviceName = String(rawName).toLowerCase().includes('demo') ? `Watch #${device.id}` : rawName
      const heading = (device as any).heading ?? null
      let entry = markersMapRef.current.get(key)
      const gpsTimestamp = verifiedFix.timestamp
      const preserveTrackedFix =
        entry?.latestFixAt !== null &&
        entry?.latestFixAt !== undefined &&
        (gpsTimestamp === null || gpsTimestamp < entry.latestFixAt)
      const fixTimestamp = entry && preserveTrackedFix ? entry.latestFixAt : gpsTimestamp
      const markerDevice = preserveTrackedFix && entry
        ? {
            ...device,
            last_latitude: entry.currentLat,
            last_longitude: entry.currentLng,
            gps_update_time: fixTimestamp !== null
              ? new Date(fixTimestamp).toISOString()
              : device.gps_update_time,
          }
        : device
      const icon = createDeviceIcon({
        isOnline,
        isSelected,
        isStale: isStaleGps(fixTimestamp),
        heading,
        deviceName,
      })
      const popupHtml = createPopupHtml(markerDevice, entry?.currentLat ?? lat, entry?.currentLng ?? lng)

      if (!entry) {
        // ── A. First time seeing this device — create marker ─────────────
        const marker = L.marker([lat, lng], {
          icon,
          zIndexOffset: isSelected ? 1200 : 1000,
        })
        marker.bindPopup(popupHtml, { maxWidth: 280 })
        marker.on('click', () => onSelectDeviceRef.current?.(device))
        marker.addTo(markersGroup)

        entry = {
          device: markerDevice,
          marker,
          currentLat: lat,
          currentLng: lng,
          latestFixAt: fixTimestamp,
        }
        markersMapRef.current.set(key, entry)
      } else {
        // ── B. Device already on map — Firestore pushed updated last_lat/last_lng ──
        entry.device = markerDevice
        const hasNewerFix = gpsTimestamp !== null &&
          (entry.latestFixAt === null || gpsTimestamp > entry.latestFixAt)
        if (!preserveTrackedFix && hasNewerFix) {
          entry.latestFixAt = gpsTimestamp
          entry.currentLat = lat
          entry.currentLng = lng
          entry.marker.setLatLng([lat, lng])
        }
        entry.marker.setIcon(icon)
        entry.marker.setZIndexOffset(isSelected ? 1200 : 1000)
        entry.marker.setPopupContent(
          createPopupHtml(entry.device, entry.currentLat, entry.currentLng)
        )

          // ── Extend the purple trail with the new Firestore-confirmed position
          // Trail path: [previous last_lat, last_lng] → [new last_lat, last_lng]
      }
    })
    lastReportedLocations.forEach(({ location }) => {
      bounds.push([location.latitude, location.longitude])
    })

    // Keep an existing verified marker when its document temporarily has no fix.
    for (const [key, entry] of markersMapRef.current.entries()) {
      if (!currentDeviceKeys.has(key)) {
        entry.marker.remove()
        markersMapRef.current.delete(key)
        setApiVerifiedMarkerIds((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        continue
      }
      if (!locatedDeviceKeys.has(key)) {
        const device = devices.find((candidate) => String(candidate.id) === key)
        if (device) {
          entry.device = {
            ...entry.device,
            last_seen: device.last_seen,
            online: device.online,
            is_online: device.is_online,
            status: device.status,
          }
          const isSelected =
            String(selectedDeviceId) === key ||
            String(selectedDeviceId) === String(device.device_id)
          entry.marker.setIcon(createDeviceIcon({
            isOnline: device.online === true || device.is_online === true,
            isSelected,
            isStale: isStaleGps(entry.latestFixAt),
            heading: entry.device.heading,
            deviceName: entry.device.device_name || `Watch #${entry.device.id}`,
          }))
          entry.marker.setPopupContent(
            createPopupHtml(entry.device, entry.currentLat, entry.currentLng)
          )
        }
      }
    }

    // Fit map to all device positions ONCE on first load only
    if (!hasInitialFittedRef.current && bounds.length > 0) {
      hasInitialFittedRef.current = true
      if (bounds.length === 1) {
        map.setView(bounds[0], 15)
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      }
    }
  }, [devices, selectedDeviceId, lastReportedLocations]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const markersGroup = markerGroupRef.current
    if (!markersGroup) return

    const currentKeys = new Set<string>()
    lastReportedLocations.forEach(({ device, location }) => {
      const key = String(device.id)
      currentKeys.add(key)
      let entry = lastReportedMarkersRef.current.get(key)
      if (!entry) {
        const marker = L.circleMarker([location.latitude, location.longitude], {
          radius: 9,
          color: '#ffffff',
          weight: 2,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          className: 'last-reported-gps-marker',
        })
        marker.bindPopup(createLastReportedPopup(device, location), { maxWidth: 280 })
        marker.addTo(markersGroup)
        entry = { device, marker, location }
        lastReportedMarkersRef.current.set(key, entry)
      } else {
        entry.device = device
        entry.location = location
        entry.marker.setLatLng([location.latitude, location.longitude])
        entry.marker.setPopupContent(createLastReportedPopup(device, location))
      }
    })

    for (const [key, entry] of lastReportedMarkersRef.current) {
      if (currentKeys.has(key)) continue
      entry.marker.remove()
      lastReportedMarkersRef.current.delete(key)
    }

    if (!hasInitialFittedRef.current && currentKeys.size > 0) {
      hasInitialFittedRef.current = true
      const positions = lastReportedLocations.map(({ location }) =>
        [location.latitude, location.longitude] as [number, number]
      )
      if (positions.length === 1) mapInstanceRef.current?.setView(positions[0], 15)
      else mapInstanceRef.current?.fitBounds(positions, { padding: [40, 40], maxZoom: 15 })
    }
  }, [lastReportedLocations, mapForTracking])

  useEffect(() => {
    if (!mapInstanceRef.current || selectedDeviceId == null) return
    const selectionKey = String(selectedDeviceId)
    if (lastCenteredSelectionRef.current === selectionKey) return

    const verifiedFix = normalizeVerifiedGpsFix(selectedDevice)
    const lastReported = lastReportedLocations.find(({ device }) =>
      String(device.id) === selectionKey || String(device.device_id) === selectionKey
    )?.location
    const position: [number, number] | null = verifiedFix
      ? [verifiedFix.latitude, verifiedFix.longitude]
      : lastReported
        ? [lastReported.latitude, lastReported.longitude]
        : null
    if (!position) return

    mapInstanceRef.current.setView(position, 15)
    lastCenteredSelectionRef.current = selectionKey
  }, [selectedDeviceId, selectedDevice, mapForTracking, lastReportedLocations])

  // ── Effect 4: Live GPS polling every 10 s ────────────────────────────────
  // Keep non-selected markers current; the selected device is polled by the route hook.
  useEffect(() => {
    if (deviceIdsKey.length === 0) return

    let isCancelled = false
    let isPolling = false
    const requestController = new AbortController()
    const applyGpsFix = (device: Device, fix: GpsLocation) => {
      const verifiedFix = normalizeVerifiedGpsFix(fix)
      if (!verifiedFix) return
      const { latitude, longitude, timestamp } = verifiedFix
      if (!isAcceptableFix(latitude, longitude)) return

      const markerKey = String(device.id)
      let entry = markersMapRef.current.get(markerKey)
      if (!entry) {
        const markerGroup = markerGroupRef.current
        if (!markerGroup) return
        const markerDevice: Device = {
          ...device,
          last_latitude: latitude,
          last_longitude: longitude,
          gps_update_time: verifiedFix.recordedAt,
          gps_fix_source: verifiedFix.source,
          has_gps_fix: true,
          gps_fix: true,
        }
        const rawName = markerDevice.device_name || markerDevice.wearer_name || `Watch #${markerDevice.id}`
        const deviceName = String(rawName).toLowerCase().includes('demo')
          ? `Watch #${markerDevice.id}`
          : rawName
        const marker = L.marker([latitude, longitude], {
          icon: createDeviceIcon({
            isOnline: markerDevice.online === true || markerDevice.is_online === true,
            isSelected: false,
            isStale: isStaleGps(timestamp),
            heading: fix.heading ?? markerDevice.heading,
            deviceName,
          }),
          zIndexOffset: 1000,
        })
        marker.bindPopup(createPopupHtml(markerDevice, latitude, longitude, fix), { maxWidth: 280 })
        marker.on('click', () => onSelectDeviceRef.current?.(device))
        marker.addTo(markerGroup)
        entry = {
          device: markerDevice,
          marker,
          currentLat: latitude,
          currentLng: longitude,
          latestFixAt: null,
        }
        markersMapRef.current.set(markerKey, entry)
      }
      if (entry.latestFixAt !== null && timestamp <= entry.latestFixAt) return

      const speed = fix.speed_kmh == null ? null : Number(fix.speed_kmh)

      entry.latestFixAt = timestamp
      entry.currentLat = latitude
      entry.currentLng = longitude
      entry.marker.setLatLng([latitude, longitude])
      entry.device = {
        ...entry.device,
        last_latitude: latitude,
        last_longitude: longitude,
        gps_update_time: new Date(timestamp).toISOString(),
        has_gps_fix: true,
        gps_fix: true,
        gps_fix_source: verifiedFix.source,
        ...(fix.speed_kmh != null ? { speed_kmh: speed } : {}),
        ...(fix.heading != null ? { heading: Number(fix.heading) } : {}),
        ...(fix.battery_pct != null ? { battery_pct: Number(fix.battery_pct) } : {}),
      }

      const rawName = entry.device.device_name || entry.device.wearer_name || `Watch #${entry.device.id}`
      const deviceName = String(rawName).toLowerCase().includes('demo')
        ? `Watch #${entry.device.id}`
        : rawName
      entry.marker.setIcon(
        createDeviceIcon({
          isOnline: entry.device.online === true || entry.device.is_online === true,
          isSelected: String(selectedDeviceId) === String(entry.device.id) ||
            String(selectedDeviceId) === String(entry.device.device_id),
          isStale: isStaleGps(entry.latestFixAt),
          heading: fix.heading ?? entry.device.heading,
          deviceName,
        })
      )
      entry.marker.setPopupContent(createPopupHtml(entry.device, latitude, longitude, fix))
      if (
        String(selectedDeviceId) === String(device.id) ||
        String(selectedDeviceId) === String(device.device_id)
      ) {
        setSelectedGpsTimestamp({ deviceKey: markerKey, timestamp })
      }
      setApiVerifiedMarkerIds((current) => new Set(current).add(markerKey))
    }

    const pollActiveWatches = async () => {
      if (isPolling || isCancelled) return
      isPolling = true
      const currentDevices = devicesRef.current
      // Poll selected device first; otherwise poll up to 5 devices
      const targets = selectedDeviceId
        ? currentDevices.filter(
            (device) =>
              String(device.id) !== String(selectedDeviceId) &&
              String(device.device_id) !== String(selectedDeviceId)
          ).slice(0, 5)
        : currentDevices.slice(0, 5)

      try {
        for (const dev of targets) {
          if (isCancelled) break
          try {
            const snapshot = await getLatestGpsSnapshot(
              dev.device_id || dev.id,
              requestController.signal
            )
            if (isCancelled) continue

            const markerKey = String(dev.id)
            const latestFix = snapshot.latest
              ? normalizeVerifiedGpsFix(snapshot.latest)
              : null
            const hasCurrentFix = Boolean(
              latestFix && isFreshGpsTimestamp(latestFix.timestamp)
            )
            setApiCurrentGpsDeviceIds((current) => {
              const next = new Set(current)
              if (hasCurrentFix) next.add(markerKey)
              else next.delete(markerKey)
              return next
            })
            if (hasCurrentFix) {
              setApiLastReportedLocations((current) => {
                const next = new Map(current)
                next.delete(markerKey)
                return next
              })
            } else if (snapshot.lastReported) {
              const lastReported = snapshot.lastReported
              setApiLastReportedLocations((current) => {
                const next = new Map(current)
                const previous = next.get(markerKey)
                if (
                  !previous ||
                  (lastReported.timestamp ?? 0) >= (previous.timestamp ?? 0)
                ) next.set(markerKey, lastReported)
                return next
              })
            }

            const latestGps = snapshot.latest
            if (!latestGps) continue

            // Only verified API GPS data can create or move a live marker.
            if (!latestGps.gps_fix) continue
            if (!isAcceptableFix(latestGps.latitude, latestGps.longitude)) continue

            applyGpsFix(dev, latestGps)
          } catch (error) {
            console.warn(`Unable to refresh GPS for device ${dev.id}; keeping the current route.`, error)
          }
        }
      } finally {
        isPolling = false
      }
    }

    // Poll every 10 s; run once immediately
    pollActiveWatches()
    const intervalId = window.setInterval(pollActiveWatches, POLL_INTERVAL_MS)

    return () => {
      isCancelled = true
      requestController.abort()
      window.clearInterval(intervalId)
    }
  }, [deviceIdsKey, selectedDeviceId])

  useEffect(() => {
    const refreshGpsStatus = () => {
      const now = Date.now()
      for (const entry of markersMapRef.current.values()) {
        const rawName =
          entry.device.device_name || (entry.device as any).wearer_name || `Watch #${entry.device.id}`
        const deviceName = String(rawName).toLowerCase().includes('demo')
          ? `Watch #${entry.device.id}`
          : rawName
        const isOnline = entry.device.online === true || entry.device.is_online === true
        entry.marker.setIcon(
          createDeviceIcon({
            isOnline,
            isSelected: String(selectedDeviceId) === String(entry.device.id),
            isStale: isStaleGps(entry.latestFixAt, now),
            heading: entry.device.heading,
            deviceName,
          })
        )
        const markerPosition = entry.marker.getLatLng()
        entry.marker.setPopupContent(
          createPopupHtml(entry.device, markerPosition.lat, markerPosition.lng)
        )
      }
    }

    refreshGpsStatus()
    const timerId = window.setInterval(refreshGpsStatus, 5_000)
    return () => window.clearInterval(timerId)
  }, [selectedDeviceId])

  // ── Recenter / fit bounds handler ─────────────────────────────────────────
  const handleRecenter = useCallback(() => {
    if (!mapInstanceRef.current) return
    const bounds: [number, number][] = locatedDevices.map((d) => [
      Number(d.last_latitude ?? (d as any).latitude),
      Number(d.last_longitude ?? (d as any).longitude),
    ])
    bounds.push(...lastReportedLocations.map(({ location }) =>
      [location.latitude, location.longitude] as [number, number]
    ))
    if (bounds.length === 0) return
    if (bounds.length === 1) {
      mapInstanceRef.current.setView(bounds[0], 16)
    } else {
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [locatedDevices, lastReportedLocations])

  // ── Fullscreen toggle ─────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((f) => {
      wrapperRef.current?.classList.toggle('is-fullscreen', !f)
      setTimeout(() => mapInstanceRef.current?.invalidateSize({ pan: false }), 100)
      return !f
    })
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className={`dashboard-live-map-wrapper${isFullscreen ? ' is-fullscreen' : ''}`}
    >
      {/* ── Map card header ── */}
      <div className="map-card-header">
        <div className="map-title-group">
          <div className="map-badge-icon">
            <Radio size={16} />
          </div>
          <div>
            <h3 className="map-heading">Live Telemetry Map</h3>
            <p className="map-subheading">
              OpenStreetMap real-time GPS positioning
              {' • '}
              {verifiedMarkerCount} verified marker{verifiedMarkerCount !== 1 ? 's' : ''}
              {lastReportedMarkerCount > 0 && (
                <>
                  {' • '}
                  {lastReportedMarkerCount} last-reported marker{lastReportedMarkerCount !== 1 ? 's' : ''}
                </>
              )}
              {' • '}
              Selected route refreshes every {SELECTED_GPS_POLL_INTERVAL_MS / 1000}s
            </p>
          </div>
        </div>

        <div className="map-controls-group">
          {selectedDevice && (
            <button
              type="button"
              className="map-action-btn"
              onClick={() => setIsTrailVisible((visible) => !visible)}
              title={isTrailVisible ? 'Hide selected device route' : 'Show selected device route'}
              aria-label={isTrailVisible ? 'Hide selected device route' : 'Show selected device route'}
              aria-pressed={isTrailVisible}
            >
              {isTrailVisible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}

          {/* Tile style selector */}
          <select
            className="map-layer-select"
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as typeof mapStyle)}
            aria-label="Map style"
          >
            <option value="standard">Standard Street</option>
            <option value="humanitarian">Humanitarian</option>
            <option value="voyager">Voyager</option>
          </select>

          {/* Recenter */}
          <button
            type="button"
            className="map-action-btn"
            onClick={handleRecenter}
            title="Recenter on all devices"
            aria-label="Recenter map"
          >
            <Compass size={16} />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            className="map-action-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'View Fullscreen'}
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* ── Map canvas ── */}
      <div className="map-canvas-container" ref={mapContainerRef}>
        {selectedDevice && (gpsRouteStatus === 'unavailable' ||
          gpsRouteStatus === 'history-sync' ||
          gpsRouteStatus === 'unavailable-history-sync' ||
          gpsRouteStatus === 'configuration-error') && (
          <div className="gps-route-status" role="status">
            {gpsRouteStatus === 'configuration-error' && (
              <p>GPS API configuration error: requests must return application/json. Check VITE_API_BASE_URL and the hosting proxy; an HTTPS page also requires an HTTPS backend or proxy.</p>
            )}
            {(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && (
              <p>A valid latest GPS fix is missing from backend history and is not added to the recorded trail.</p>
            )}
            {(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') && (
              <p>{selectedMarkerIsLastKnown
                ? (selectedLastReported
                  ? 'GPS No Fix — Showing Last Reported Location — Unverified; the trail contains verified history only.'
                  : 'No live GPS fix is available. Showing the last verified location; the trail contains verified history only.')
                : !selectedHasVerifiedPosition
                  ? 'No GPS Location Available for this device. No usable coordinates were returned.'
                  : 'No fresh verified GPS fix is available. Any visible trail contains verified recorded history only.'}</p>
            )}
          </div>
        )}
        {verifiedMarkerCount === 0 && lastReportedMarkerCount === 0 && (
          <div className="map-empty-overlay">
            <div className="map-empty-badge">
              <Compass size={24} className="text-cyan-600 mb-2" />
              <h4>No GPS Location Available</h4>
              <p>No verified fix or usable historical coordinates are available for this device.</p>
              <Link to="/admin/device-management" className="map-empty-link">
                Manage Devices &rarr;
              </Link>
            </div>
          </div>
        )}
        {lastReportedMarkerCount > 0 &&
          (verifiedMarkerCount === 0 || selectedLastReported !== null) && (
          <div className="last-reported-status" role="status">
            GPS No Fix — Showing Last Reported Location — Unverified. This historical location may be outdated.
          </div>
        )}
      </div>

      {/* ── Inline styles ── */}
      <style>{`
        /* ── GPS marker icon ─────────────────────────────────────────────── */
        .custom-gps-pin {
          background: transparent !important;
          border: none !important;
        }

        .custom-gps-pin.gps-marker-moving {
          transition: transform 700ms ease-out;
        }

        /* Pulse ring animation on selected/live marker */
        @keyframes gpsPulse {
          0%   { transform: scale(0.9); opacity: 0.6; }
          70%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }

        /* ── Selected device GPS route ────────────────────────────────────── */
        .leaflet-overlay-pane svg path.gps-trail-line {
          stroke: #2563eb !important;
          stroke-width: 3px !important;
          stroke-opacity: 0.9 !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
          fill: none !important;
        }

        .leaflet-overlay-pane .gps-trail-dot {
          fill: #2563eb !important;
          fill-opacity: 1 !important;
          stroke: #ffffff !important;
          stroke-width: 1px !important;
        }

        .gps-route-status {
          position: absolute;
          z-index: 500;
          left: 12px;
          bottom: 58px;
          max-width: 420px;
          padding: 8px 12px;
          border: 1px solid #bfdbfe;
          border-radius: 6px;
          background: rgba(239, 246, 255, 0.96);
          color: #1e3a8a;
          font-size: 12px;
          line-height: 1.4;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
        }

        .last-reported-gps-marker {
          fill: #f59e0b !important;
          fill-opacity: 1 !important;
          stroke: #ffffff !important;
          stroke-width: 2px !important;
        }

        .last-reported-status {
          position: absolute;
          z-index: 500;
          left: 12px;
          bottom: 12px;
          max-width: 460px;
          padding: 8px 12px;
          border: 1px solid #fcd34d;
          border-radius: 6px;
          background: rgba(255, 251, 235, 0.96);
          color: #92400e;
          font-size: 12px;
          line-height: 1.4;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
        }

      `}</style>
    </div>
  )
}
