import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Maximize2,
  Minimize2,
  Radio,
  Compass,
} from 'lucide-react'
import { getLatestGpsLocation, type Device } from '../../services/api'
import { isValidGpsCoord } from '../../lib/firebase'
import { Link } from 'react-router-dom'

interface DashboardLiveMapProps {
  devices: Device[]
  onSelectDevice?: (device: Device) => void
  selectedDeviceId?: number | string | null
}

interface MarkerEntry {
  device: Device
  marker: L.Marker
  currentLat: number
  currentLng: number
  targetLat: number
  targetLng: number
  animFrameId?: number
}

/**
 * Creates custom high-precision GPS marker icon with animated pulse ring,
 * optional heading direction arrow, and wearer name label.
 */
function createDeviceIcon(options: {
  isOnline: boolean
  isSelected: boolean
  heading?: number | null
  deviceName?: string | null
}): L.DivIcon {
  const { isOnline, isSelected, heading, deviceName } = options

  const coreColor = isSelected ? '#2563eb' : isOnline ? '#10b981' : '#64748b'
  const ringColor = isSelected ? '#1d4ed8' : isOnline ? '#059669' : '#475569'
  const haloColor = isSelected
    ? 'rgba(37, 99, 235, 0.35)'
    : isOnline
    ? 'rgba(16, 185, 129, 0.35)'
    : 'transparent'
  const scale = isSelected ? 'scale(1.18)' : 'scale(1)'

  const hasHeading = heading != null && Number.isFinite(heading) && heading >= 0
  const rotation = hasHeading ? heading : 0

  const innerGraphic = hasHeading
    ? `<div style="transform: rotate(${rotation}deg); font-size: 11px; line-height: 1; font-weight: 900; color: #ffffff;">▲</div>`
    : `<div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 3px rgba(0,0,0,0.4);"></div>`

  const namePillHtml = deviceName
    ? `<div class="marker-name-pill" style="
        position: absolute;
        top: -24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.90);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 10px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.22);
      ">${deviceName}</div>`
    : ''

  return L.divIcon({
    className: 'custom-gps-pin',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -22],
    html: `
      <div class="pin-wrapper" style="
        position: relative;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: ${scale};
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      ">
        ${namePillHtml}
        ${isOnline ? `<div class="pin-pulse" style="background: ${haloColor};"></div>` : ''}
        <div style="
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: ${coreColor};
          border: 2.5px solid #ffffff;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), 0 0 0 2px ${ringColor};
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 2;
        ">
          ${innerGraphic}
        </div>
      </div>
    `,
  })
}

/**
 * Creates rich telemetry popup content for a device on the live map.
 */
function createPopupHtml(device: Device, lat: number, lng: number): string {
  const isOnline =
    (device as any).online === true ||
    (device as any).is_online === true ||
    (device as any).is_active === true ||
    String(device.status || (device as any).connection_status || '').toLowerCase() === 'online' ||
    String(device.status || '').toLowerCase() === 'active'

  const hasFix = (device as any).has_gps_fix !== false && (device as any).gps_fix !== false
  const lastSeenFormatted = device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Live'
  const speed = (device as any).speed_kmh ?? (device as any).speed ?? null
  const heading = (device as any).heading ?? null
  const battery = device.battery_pct ?? (device as any).battery_percent ?? (device as any).battery ?? null
  const rawWearer = device.device_name || (device as any).wearer_name || device.serial_number || `Watch #${device.id}`
  const wearer = String(rawWearer).toLowerCase().includes('demo') ? `Watch #${device.id}` : rawWearer

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.4; min-width: 220px; padding: 4px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">
        <strong style="color: #0f172a; font-size: 14px;">${wearer}</strong>
        <span style="font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; background: ${isOnline ? '#dcfce7' : '#f1f5f9'}; color: ${isOnline ? '#15803d' : '#64748b'};">
          ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div style="color: #475569; font-size: 11px; margin-bottom: 3px;">
        <strong>IMEI:</strong> ${device.imei || device.serial_number || 'N/A'}
      </div>
      <div style="color: #475569; font-size: 11px; margin-bottom: 3px;">
        <strong>Battery:</strong> <span style="font-weight: 600; color: ${battery != null && battery <= 20 ? '#dc2626' : '#16a34a'};">${battery != null ? `${battery}%` : 'N/A'}</span>
      </div>
      ${speed != null && speed > 0 ? `<div style="color: #475569; font-size: 11px; margin-bottom: 3px;"><strong>Speed:</strong> ${speed} km/h</div>` : ''}
      ${heading != null && heading >= 0 ? `<div style="color: #475569; font-size: 11px; margin-bottom: 3px;"><strong>Heading:</strong> ${Math.round(heading)}°</div>` : ''}
      <div style="color: #475569; font-size: 11px; margin-bottom: 3px;">
        <strong>GPS Status:</strong> <span style="font-weight: 600; color: ${hasFix ? '#16a34a' : '#d97706'};">${hasFix ? 'GPS Active' : 'No GPS Fix'}</span>
      </div>
      <div style="color: #64748b; font-size: 10px; margin-bottom: 3px;">
        <strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}
      </div>
      <div style="color: #64748b; font-size: 10px; margin-bottom: 8px;">
        <strong>Last Update:</strong> ${lastSeenFormatted}
      </div>
      <a href="/admin/journeys?device=${device.id}" style="display: block; text-align: center; background: #2563eb; color: #ffffff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 4px;">
        View Live Route & Journey &rarr;
      </a>
      <a href="/admin/monitoring-center?device=${device.id}" style="display: block; text-align: center; background: #f1f5f9; color: #334155; text-decoration: none; padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 600;">
        Open Monitoring Center &rarr;
      </a>
    </div>
  `
}

/**
 * Smoothly animates a Leaflet marker between coordinates via requestAnimationFrame
 * using an ease-out cubic curve. This ensures the dot glides fluidly across the
 * map without any jumping, blinking, or screen refreshes.
 */
function animateMarker(
  entry: MarkerEntry,
  toLat: number,
  toLng: number,
  durationMs = 950
) {
  if (entry.animFrameId) {
    cancelAnimationFrame(entry.animFrameId)
    entry.animFrameId = undefined
  }

  const fromLat = entry.currentLat
  const fromLng = entry.currentLng

  // Micro-jitter filter (< 0.3 meter movement)
  if (Math.abs(toLat - fromLat) < 0.000003 && Math.abs(toLng - fromLng) < 0.000003) {
    entry.marker.setLatLng([toLat, toLng])
    entry.currentLat = toLat
    entry.currentLng = toLng
    return
  }

  const startTime = performance.now()
  // Ease Out Cubic: natural glide with smooth deceleration
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

  const step = (now: number) => {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / durationMs, 1)
    const eased = easeOutCubic(progress)

    const lat = fromLat + (toLat - fromLat) * eased
    const lng = fromLng + (toLng - fromLng) * eased

    entry.marker.setLatLng([lat, lng])
    entry.currentLat = lat
    entry.currentLng = lng

    if (progress < 1) {
      entry.animFrameId = requestAnimationFrame(step)
    } else {
      entry.marker.setLatLng([toLat, toLng])
      entry.currentLat = toLat
      entry.currentLng = toLng
      entry.animFrameId = undefined
    }
  }

  entry.animFrameId = requestAnimationFrame(step)
}

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

  // Filter devices that have valid GPS coordinates
  const locatedDevices = devices.filter((d) => {
    const lat = d.last_latitude ?? (d as any).latitude
    const lng = d.last_longitude ?? (d as any).longitude
    return isValidGpsCoord(lat, lng)
  })

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return

    const firstLocated = locatedDevices[0]
    const initialCenter: [number, number] = firstLocated
      ? [
          Number(firstLocated.last_latitude ?? (firstLocated as any).latitude),
          Number(firstLocated.last_longitude ?? (firstLocated as any).longitude),
        ]
      : [20.5937, 78.9629]
    const initialZoom = firstLocated ? 14 : 4

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const initialTiles = L.tileLayer(mapTileProviders[mapStyle].url, {
      maxZoom: 19,
      attribution: mapTileProviders[mapStyle].attribution,
    }).addTo(map)

    const markers = L.layerGroup().addTo(map)

    mapInstanceRef.current = map
    markerGroupRef.current = markers
    tileLayerRef.current = initialTiles

    // Handle container resize smoothly
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
    })
    resizeObserver.observe(mapContainerRef.current)

    return () => {
      resizeObserver.disconnect()

      // Clean up any running marker animations
      for (const entry of markersMapRef.current.values()) {
        if (entry.animFrameId) cancelAnimationFrame(entry.animFrameId)
      }
      markersMapRef.current.clear()

      map.remove()
      mapInstanceRef.current = null
      markerGroupRef.current = null
      tileLayerRef.current = null
    }
  }, [])

  // 2. Switch Tile Style
  useEffect(() => {
    if (!mapInstanceRef.current) return
    if (tileLayerRef.current) {
      tileLayerRef.current.remove()
    }
    const provider = mapTileProviders[mapStyle]
    tileLayerRef.current = L.tileLayer(provider.url, {
      maxZoom: 19,
      attribution: provider.attribution,
    }).addTo(mapInstanceRef.current)
  }, [mapStyle])

  // 3. Update Markers smoothly without recreating or resetting map viewport
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

      const isSelected = String(selectedDeviceId) === key
      const isOnline =
        (device as any).online === true ||
        (device as any).is_online === true ||
        (device as any).is_active === true ||
        String(device.status || (device as any).connection_status || '').toLowerCase() === 'online' ||
        String(device.status || '').toLowerCase() === 'active'

      const rawName = device.device_name || (device as any).wearer_name || `Watch #${device.id}`
      const deviceName = String(rawName).toLowerCase().includes('demo') ? `Watch #${device.id}` : rawName
      const heading = (device as any).heading ?? null

      const icon = createDeviceIcon({
        isOnline,
        isSelected,
        heading,
        deviceName,
      })

      const popupHtml = createPopupHtml(device, lat, lng)

      let entry = markersMapRef.current.get(key)

      if (!entry) {
        // --- A. NEW MARKER: Create once and add to persistent registry ---
        const marker = L.marker([lat, lng], {
          icon,
          zIndexOffset: isSelected ? 1200 : 1000,
        })

        marker.bindPopup(popupHtml)
        marker.on('click', () => {
          onSelectDevice?.(device)
        })

        marker.addTo(markersGroup)

        entry = {
          device,
          marker,
          currentLat: lat,
          currentLng: lng,
          targetLat: lat,
          targetLng: lng,
        }
        markersMapRef.current.set(key, entry)
      } else {
        // --- B. EXISTING MARKER: Update in-place & animate position smoothly ---
        entry.device = device
        entry.marker.setIcon(icon)
        entry.marker.setZIndexOffset(isSelected ? 1200 : 1000)
        entry.marker.setPopupContent(popupHtml)

        // If coordinates changed, glide smoothly to new position!
        if (
          Math.abs(entry.currentLat - lat) > 0.000003 ||
          Math.abs(entry.currentLng - lng) > 0.000003
        ) {
          entry.targetLat = lat
          entry.targetLng = lng
          animateMarker(entry, lat, lng)
        }
      }
    })

    // Clean up markers for removed devices
    for (const [key, entry] of markersMapRef.current.entries()) {
      if (!currentDeviceKeys.has(key)) {
        if (entry.animFrameId) cancelAnimationFrame(entry.animFrameId)
        entry.marker.remove()
        markersMapRef.current.delete(key)
      }
    }

    // Initial viewport: fit bounds ONCE only on first load!
    // NEVER call fitBounds on subsequent coordinates updates to avoid jarring resets!
    if (!hasInitialFittedRef.current && bounds.length > 0) {
      hasInitialFittedRef.current = true
      if (bounds.length === 1) {
        map.setView(bounds[0], 15)
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      }
    }
  }, [devices, selectedDeviceId])

  // 4. Smooth Pan when selected device changes
  useEffect(() => {
    if (!selectedDeviceId || !mapInstanceRef.current) return
    const entry = markersMapRef.current.get(String(selectedDeviceId))
    if (entry) {
      mapInstanceRef.current.panTo([entry.currentLat, entry.currentLng], {
        animate: true,
        duration: 0.8,
      })
    }
  }, [selectedDeviceId])

  // 5. Shortest-time telemetry polling: 3-second background polling for active watches
  useEffect(() => {
    if (locatedDevices.length === 0) return

    let isCancelled = false

    const pollActiveWatches = async () => {
      // Poll selected watch first, or all located watches
      const targets = selectedDeviceId
        ? locatedDevices.filter((d) => String(d.id) === String(selectedDeviceId))
        : locatedDevices.slice(0, 5)

      for (const dev of targets) {
        if (isCancelled) break
        try {
          const latestGps = await getLatestGpsLocation(dev.id)
          if (isCancelled || !latestGps) continue
          if (!isValidGpsCoord(latestGps.latitude, latestGps.longitude)) continue

          const entry = markersMapRef.current.get(String(dev.id))
          if (entry) {
            // Check if coordinates moved
            const hasMoved =
              Math.abs(entry.targetLat - latestGps.latitude) > 0.000003 ||
              Math.abs(entry.targetLng - latestGps.longitude) > 0.000003

            if (hasMoved) {
              entry.targetLat = latestGps.latitude
              entry.targetLng = latestGps.longitude

              const updatedDev: Device = {
                ...entry.device,
                last_latitude: latestGps.latitude,
                last_longitude: latestGps.longitude,
                battery_pct: latestGps.battery_pct ?? entry.device.battery_pct,
                last_seen: latestGps.recorded_at,
                ...(latestGps.speed_kmh != null ? { speed_kmh: latestGps.speed_kmh } : {}),
                ...(latestGps.heading != null ? { heading: latestGps.heading } : {}),
              } as Device
              entry.device = updatedDev

              entry.marker.setPopupContent(
                createPopupHtml(updatedDev, latestGps.latitude, latestGps.longitude)
              )

              entry.marker.setIcon(
                createDeviceIcon({
                  isOnline: true,
                  isSelected: String(selectedDeviceId) === String(dev.id),
                  heading: latestGps.heading,
                  deviceName: (() => {
                    const n = updatedDev.device_name || (updatedDev as any).wearer_name || `Watch #${updatedDev.id}`
                    return String(n).toLowerCase().includes('demo') ? `Watch #${updatedDev.id}` : n
                  })(),
                })
              )

              // Glide the dot smoothly to the new position!
              animateMarker(entry, latestGps.latitude, latestGps.longitude, 1000)

              // If currently selected, gently pan along with movement
              if (String(selectedDeviceId) === String(dev.id) && mapInstanceRef.current) {
                mapInstanceRef.current.panTo([latestGps.latitude, latestGps.longitude], {
                  animate: true,
                  duration: 0.8,
                })
              }
            }
          }
        } catch {
          // Continue gracefully
        }
      }
    }

    const intervalId = window.setInterval(pollActiveWatches, 3000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [locatedDevices.map((d) => d.id).join(','), selectedDeviceId])

  // Recenter / fit bounds manually
  const handleRecenter = useCallback(() => {
    if (!mapInstanceRef.current) return
    if (locatedDevices.length > 0) {
      const bounds: [number, number][] = locatedDevices.map((d) => [
        Number(d.last_latitude ?? (d as any).latitude),
        Number(d.last_longitude ?? (d as any).longitude),
      ])
      if (bounds.length === 1) {
        mapInstanceRef.current.setView(bounds[0], 15)
      } else {
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] })
      }
    }
  }, [locatedDevices])

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!wrapperRef.current) return
    if (!isFullscreen) {
      if (wrapperRef.current.requestFullscreen) {
        wrapperRef.current.requestFullscreen()
      }
      setIsFullscreen(true)
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
      setIsFullscreen(false)
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={'dashboard-live-map-wrapper ' + (isFullscreen ? 'is-fullscreen' : '')}
    >
      {/* Map Header Bar */}
      <div className="map-card-header">
        <div className="map-title-group">
          <div className="map-badge-icon">
            <Radio size={16} className="text-emerald-500 animate-pulse" />
          </div>
          <div>
            <h3 className="map-heading">Live Telemetry Map</h3>
            <p className="map-subheading">
              OpenStreetMap real-time GPS positioning &bull; {locatedDevices.length} active markers
              &bull; 3s live polling
            </p>
          </div>
        </div>

        {/* Map View & Control Actions */}
        <div className="map-controls-group">
          {/* Layer switcher */}
          <select
            className="map-layer-select"
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as any)}
            aria-label="Map Tile Style"
          >
            <option value="standard">Standard Street</option>
            <option value="voyager">Carto Light</option>
            <option value="humanitarian">Humanitarian</option>
          </select>

          {/* Recenter */}
          <button
            type="button"
            className="map-action-btn"
            onClick={handleRecenter}
            title="Recenter Map View"
            aria-label="Recenter Map"
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

      {/* Map Canvas */}
      <div className="map-canvas-container" ref={mapContainerRef}>
        {locatedDevices.length === 0 && (
          <div className="map-empty-overlay">
            <div className="map-empty-badge">
              <Compass size={24} className="text-cyan-600 mb-2" />
              <h4>Awaiting GPS Coordinates</h4>
              <p>Registered bands will appear live on this OpenStreetMap grid as soon as telemetry packets arrive.</p>
              <Link to="/admin/device-management" className="map-empty-link">
                Manage Devices &rarr;
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Pulse Pin Animation Styles */}
      <style>{`
        .pin-pulse {
          position: absolute;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          animation: mapPulse 2s infinite ease-out;
          pointer-events: none;
        }
        @keyframes mapPulse {
          0% { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .custom-gps-pin {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  )
}
