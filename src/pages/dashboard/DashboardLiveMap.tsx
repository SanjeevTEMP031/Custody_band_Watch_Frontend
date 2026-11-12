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
  getLatestGpsLocation,
  type Device,
  type GpsLocation,
} from '../../services/api'
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
    ? ` <span style="color:#fbbf24;">⚠ Stale</span>`
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

  const speed = overrides?.speed_kmh ?? d.speed_kmh ?? d.speed ?? null
  const heading = overrides?.heading ?? d.heading ?? null
  const battery =
    overrides?.battery_pct ??
    device.battery_pct ??
    d.battery_percent ??
    d.battery ??
    null
  const lastSeenStr = fixTimestamp !== null ? new Date(fixTimestamp).toLocaleString() : '—'

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
      <div style="color:#475569;font-size:11px;margin-bottom:3px;"><strong>GPS Status:</strong> <span style="font-weight:600;color:${isStale ? '#d97706' : '#16a34a'};">${isStale ? '🟡 Stale' : fixTimestamp !== null ? '🟢 Recent Fix' : '⚪ Time Unknown'}</span></div>
      <div style="color:#64748b;font-size:10px;margin-bottom:3px;"><strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <div style="color:#64748b;font-size:10px;margin-bottom:8px;"><strong>GPS Time:</strong> ${lastSeenStr}</div>
      <a href="/admin/journeys?device=${device.id}" style="display:block;text-align:center;background:#2563eb;color:#ffffff;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:4px;">
        View Live Route &amp; Journey →
      </a>
      <a href="/admin/monitoring-center?device=${device.id}" style="display:block;text-align:center;background:#f1f5f9;color:#334155;text-decoration:none;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:600;">
        Open Monitoring Center →
      </a>
    </div>
  `
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
  const hasInitialFittedRef = useRef<boolean>(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [mapStyle, setMapStyle] = useState<'standard' | 'humanitarian' | 'voyager'>('standard')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTrailVisible, setIsTrailVisible] = useState(true)
  const [mapForTracking, setMapForTracking] = useState<L.Map | null>(null)
  const [gpsRouteStatus, setGpsRouteStatus] = useState<SelectedGpsRouteStatus>('loading')

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

  // Only devices that have a known, valid coordinate to show on the map
  const locatedDevices = devices.filter((d) => {
    const lat = d.last_latitude ?? (d as any).latitude
    const lng = d.last_longitude ?? (d as any).longitude
    return isAcceptableFix(Number(lat), Number(lng))
  })

  const selectedDevice = devices.find(
    (device) =>
      String(device.id) === String(selectedDeviceId) ||
      String(device.device_id) === String(selectedDeviceId)
  )
  const trackingDeviceId = selectedDevice
    ? String(selectedDevice.device_id || selectedDevice.imei || selectedDevice.serial_number || selectedDevice.id)
    : null
  const firestoreLatest = useMemo<GpsLocation | null>(() => {
    if (
      selectedDevice?.gps_fix_source !== 'firestore_last_fix' ||
      selectedDevice.has_gps_fix !== true ||
      selectedDevice.last_latitude == null ||
      selectedDevice.last_longitude == null ||
      !selectedDevice.gps_update_time
    ) return null
    return {
      device_id: trackingDeviceId ?? undefined,
      latitude: selectedDevice.last_latitude,
      longitude: selectedDevice.last_longitude,
      recorded_at: selectedDevice.gps_update_time,
      gps_fix: true,
      gps_status: 'GPS Locked',
      status: 'GPS Locked',
    }
  }, [selectedDevice, trackingDeviceId])

  const handleFreshGpsPoint = useCallback((point: GpsLocation) => {
    if (selectedDeviceId == null) return
    const markerKey = String(selectedDevice?.id ?? selectedDeviceId)
    const latitude = Number(point.latitude)
    const longitude = Number(point.longitude)
    const timestamp = timestampMillis(point.recorded_at)
    if (timestamp === null || !isAcceptableFix(latitude, longitude)) return
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
      }
      const marker = L.marker([latitude, longitude], {
        icon: createDeviceIcon({
          isOnline: device.online === true || device.is_online === true,
          isSelected: true,
          isStale: false,
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
    }
    if (entry.latestFixAt !== null && timestamp <= entry.latestFixAt) return

    entry.currentLat = latitude
    entry.currentLng = longitude
    entry.latestFixAt = timestamp
    entry.device = {
      ...entry.device,
      last_latitude: latitude,
      last_longitude: longitude,
      gps_update_time: new Date(timestamp).toISOString(),
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
      isStale: false,
      heading: point.heading ?? entry.device.heading,
      deviceName: entry.device.device_name || `Watch #${entry.device.id}`,
    }))
    entry.marker.setPopupContent(
      createPopupHtml(entry.device, latitude, longitude, point)
    )
  }, [onSelectDevice, selectedDevice, selectedDeviceId])

  useSelectedGpsRoute(
    mapForTracking,
    trackingDeviceId,
    isTrailVisible,
    handleFreshGpsPoint,
    undefined,
    setGpsRouteStatus,
    mapForTracking !== null,
    firestoreLatest
  )

  // ── Effect 1: Initialise Leaflet map (runs ONCE) ──────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return

    const firstLocated = locatedDevices[0]
    const initialCenter: [number, number] = firstLocated
      ? [
          Number(firstLocated.last_latitude ?? (firstLocated as any).latitude),
          Number(firstLocated.last_longitude ?? (firstLocated as any).longitude),
        ]
      : [20.5937, 78.9629] // India centre as fallback
    const initialZoom = firstLocated ? 15 : 4

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
      markersMapRef.current.clear()
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

    const currentDeviceKeys = new Set<string>()
    const bounds: [number, number][] = []

    locatedDevices.forEach((device) => {
      const key = String(device.id)
      currentDeviceKeys.add(key)

      const lat = Number(device.last_latitude ?? (device as any).latitude)
      const lng = Number(device.last_longitude ?? (device as any).longitude)
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
      const gpsTimestamp = timestampMillis(device.gps_update_time)
      const preserveTrackedFix =
        isSelected &&
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
        marker.on('click', () => onSelectDevice?.(device))
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
        if (!preserveTrackedFix && gpsTimestamp !== null) {
          entry.latestFixAt = gpsTimestamp
        }
        entry.marker.setIcon(icon)
        entry.marker.setZIndexOffset(isSelected ? 1200 : 1000)
        entry.marker.setPopupContent(popupHtml)

          // ── Extend the purple trail with the new Firestore-confirmed position
          // Trail path: [previous last_lat, last_lng] → [new last_lat, last_lng]
      }
    })

    // Remove markers/trails for devices no longer in the list
    for (const [key, entry] of markersMapRef.current.entries()) {
      if (!currentDeviceKeys.has(key)) {
        if (key === String(selectedDevice?.id) && entry.latestFixAt !== null) continue
        entry.marker.remove()
        markersMapRef.current.delete(key)
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
  }, [devices, selectedDeviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 4: Live GPS polling every 10 s ────────────────────────────────
  // Keep non-selected markers current; the selected device is polled by the route hook.
  useEffect(() => {
    if (locatedDevices.length === 0) return

    let isCancelled = false
    const applyGpsFix = (entry: MarkerEntry, fix: GpsLocation) => {
      const latitude = Number(fix.latitude)
      const longitude = Number(fix.longitude)
      const timestamp = timestampMillis(fix.recorded_at)
      const status = String(fix.status ?? fix.gps_status ?? '').toUpperCase()
      if (
        fix.gps_fix === false ||
        status === 'V' ||
        timestamp === null ||
        !isAcceptableFix(latitude, longitude) ||
        (entry.latestFixAt !== null && timestamp <= entry.latestFixAt)
      ) return

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
          isSelected: String(selectedDeviceId) === String(entry.device.id),
          isStale: isStaleGps(entry.latestFixAt),
          heading: fix.heading ?? entry.device.heading,
          deviceName,
        })
      )
      entry.marker.setPopupContent(createPopupHtml(entry.device, latitude, longitude, fix))
    }

    const pollActiveWatches = async () => {
      // Poll selected device first; otherwise poll up to 5 devices
      const targets = selectedDeviceId
        ? locatedDevices.filter(
            (device) =>
              String(device.id) !== String(selectedDeviceId) &&
              String(device.device_id) !== String(selectedDeviceId)
          ).slice(0, 5)
        : locatedDevices.slice(0, 5)

      for (const dev of targets) {
        if (isCancelled) break
        try {
          const latestGps = await getLatestGpsLocation(dev.id)
          if (isCancelled || !latestGps) continue

          // ── C05 GPS fix validation ──────────────────────────────────────
          // Reject: V-status (gps_fix = false) or zero/null coordinates
          if (!latestGps.gps_fix) continue
          if (!isAcceptableFix(latestGps.latitude, latestGps.longitude)) continue

          const entry = markersMapRef.current.get(String(dev.id))
          if (!entry) continue

          applyGpsFix(entry, latestGps)
        } catch (error) {
          console.warn(`Unable to refresh GPS for device ${dev.id}; keeping the current route.`, error)
        }
      }
    }

    // Poll every 10 s; run once immediately
    pollActiveWatches()
    const intervalId = window.setInterval(pollActiveWatches, POLL_INTERVAL_MS)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [locatedDevices.map((d) => d.id).join(','), selectedDeviceId])

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
    if (locatedDevices.length === 0) return
    const bounds: [number, number][] = locatedDevices.map((d) => [
      Number(d.last_latitude ?? (d as any).latitude),
      Number(d.last_longitude ?? (d as any).longitude),
    ])
    if (bounds.length === 1) {
      mapInstanceRef.current.setView(bounds[0], 16)
    } else {
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [locatedDevices])

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
              {locatedDevices.length} active marker{locatedDevices.length !== 1 ? 's' : ''}
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
        {selectedDevice && (gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'history-mismatch') && (
          <div className="gps-route-status" role="status">
            {gpsRouteStatus === 'history-mismatch'
              ? 'A newer source-verified Firestore GPS fix is not in backend history. The marker may show that fix, but it is not added to the recorded trail until the backend history confirms it.'
              : 'No fresh valid GPS fix received from the backend. Any visible trail contains recorded GPS points only; no movement is simulated.'}
          </div>
        )}
        {locatedDevices.length === 0 && (
          <div className="map-empty-overlay">
            <div className="map-empty-badge">
              <Compass size={24} className="text-cyan-600 mb-2" />
              <h4>Awaiting GPS Coordinates</h4>
              <p>Registered bands will appear live on this OpenStreetMap grid as soon as telemetry packets are received from the C05 GPS watch.</p>
              <Link to="/admin/device-management" className="map-empty-link">
                Manage Devices &rarr;
              </Link>
            </div>
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
          bottom: 12px;
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

      `}</style>
    </div>
  )
}
