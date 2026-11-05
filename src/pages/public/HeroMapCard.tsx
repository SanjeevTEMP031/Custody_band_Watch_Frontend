import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface HeroMapCardProps {
  lat?: number | null
  lon?: number | null
  wearer?: string | null
  caseNumber?: string | null
  deviceId?: string | null
  battery?: number | null
  heartRate?: number | null
  steps?: number | null
  isOnline?: boolean
}

export default function HeroMapCard({
  lat = null,
  lon = null,
  wearer = null,
  caseNumber = null,
  deviceId = null,
  battery = null,
  heartRate = null,
  steps = null,
  isOnline = false
}: HeroMapCardProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [mapMode, setMapMode] = useState<'satellite' | 'osm'>('satellite')

  const hasGps = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)

  // Initialize and update Leaflet map when in interactive OpenStreetMap mode
  useEffect(() => {
    if (mapMode !== 'osm' || !mapContainer.current) return

    const initialCenter: [number, number] = hasGps ? [lat!, lon!] : [20.5937, 78.9629]

    if (!mapInstance.current) {
      const map = L.map(mapContainer.current, {
        center: initialCenter,
        zoom: hasGps ? 15 : 4,
        zoomControl: false,
        attributionControl: false
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

      if (hasGps) {
        const markerIcon = L.divIcon({
          className: 'hero-map-marker',
          html: `
            <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
              <div style="position: absolute; width: 36px; height: 36px; border-radius: 50%; background: #06b6d4; opacity: 0.35; animation: pulse 2s infinite ease-out;"></div>
              <div style="position: absolute; width: 22px; height: 22px; border-radius: 50%; background: #071527; border: 3px solid #06b6d4; box-shadow: 0 0 12px #06b6d4; display: flex; align-items: center; justify-content: center;">
                <div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></div>
              </div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        })

        const marker = L.marker([lat!, lon!], { icon: markerIcon }).addTo(map)
        marker.bindPopup(`<strong>${wearer || 'Monitored Band'}</strong><br/>IMEI: ${deviceId || 'N/A'}`)
        markerRef.current = marker
      }

      mapInstance.current = map
    } else if (hasGps) {
      mapInstance.current.setView([lat!, lon!], 15)
      if (markerRef.current) {
        markerRef.current.setLatLng([lat!, lon!])
      }
    }
  }, [mapMode, lat, lon, wearer, hasGps, deviceId])

  const coordText = hasGps
    ? `${lat!.toFixed(5)}°, ${lon!.toFixed(5)}°`
    : 'No GPS Fix'

  const battText = battery != null ? `${battery}%` : 'N/A'
  const hrText = heartRate != null ? `${heartRate} BPM` : 'N/A'
  const stepsText = steps != null ? Number(steps).toLocaleString() : 'N/A'
  const idText = deviceId || 'N/A'

  return (
    <div className="hero-concept-card">
      {/* Top Header: DEVICE CONCEPT & View Controls */}
      <div className="concept-header">
        <div className="concept-tag">
          <span className="concept-dot" />
          <span>DEVICE LIVE TELEMETRY</span>
        </div>
        <div className="concept-controls">
          <button
            type="button"
            className={`mode-toggle-btn ${mapMode === 'satellite' ? 'active' : ''}`}
            onClick={() => setMapMode('satellite')}
            title="Realistic 3D Aerial Satellite Tracking View"
          >
            🛰️ Satellite View
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${mapMode === 'osm' ? 'active' : ''}`}
            onClick={() => setMapMode('osm')}
            title="Interactive OpenStreetMap Street View"
          >
            🗺️ OpenStreetMap
          </button>
        </div>
      </div>

      {/* Main Map Stage */}
      <div className="concept-stage">
        {mapMode === 'satellite' ? (
          <div className="tactical-map-viewport">
            <img
              src="/assets/images/realistic_satellite_map.jpg"
              alt="Satellite GPS Tracking Map"
              className="tactical-map-img"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ) : (
          <div className="interactive-map-viewport" style={{ width: '100%', height: '100%' }}>
            <div ref={mapContainer} className="hero-leaflet-canvas" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
          </div>
        )}
      </div>

      {/* Card Bottom */}
      <div className="concept-footer">
        <div className="concept-device-meta">
          <span className="meta-primary">Electronic monitoring device</span>
          <span className="meta-secondary">IMEI: {idText} · 4G LTE {isOnline ? 'Active' : 'Offline'}</span>
        </div>

        {/* Floating Location Card */}
        <div className="floating-location-card">
          <div className="location-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="location-info-text">
            <div className="loc-title">GPS Coordinates</div>
            <div className="loc-subtitle">{coordText}</div>
            <div className="loc-subject">{wearer || idText} {caseNumber ? `· Case #${caseNumber}` : ''}</div>
          </div>
        </div>
      </div>

      {/* Live Vitals Micro Strip */}
      <div className="concept-telemetry-strip">
        <span>🔋 <strong>{battText}</strong> Batt</span>
        <span>❤️ <strong>{hrText}</strong></span>
        <span>👟 <strong>{stepsText}</strong> Steps</span>
        <span className="status-online-tag" style={{ color: isOnline ? '#10b981' : '#94a3b8' }}>
          ● {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  )
}
