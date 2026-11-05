import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface HeroMapCardProps {
  lat?: number
  lon?: number
  wearer?: string
  caseNumber?: string
  deviceId?: string
  battery?: number
  heartRate?: number
  steps?: number
  isOnline?: boolean
}

export default function HeroMapCard({
  lat = 40.7128,
  lon = -74.0060,
  wearer = 'Assigned Subject',
  caseNumber = 'CASE-2026-EM01',
  deviceId = '863758******420',
  battery = 92,
  heartRate = 72,
  steps = 4120,
  isOnline = true
}: HeroMapCardProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [mapMode, setMapMode] = useState<'satellite' | 'osm'>('satellite')

  // Initialize and update Leaflet map when in interactive OpenStreetMap mode
  useEffect(() => {
    if (mapMode !== 'osm' || !mapContainer.current) return

    if (!mapInstance.current) {
      const map = L.map(mapContainer.current, {
        center: [lat, lon],
        zoom: 15,
        zoomControl: false,
        attributionControl: false
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

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

      const marker = L.marker([lat, lon], { icon: markerIcon }).addTo(map)
      marker.bindPopup(`
        <div style="font-family: Inter, sans-serif; font-size: 12px; color: #0f172a; padding: 2px;">
          <strong>${wearer}</strong><br/>
          <span style="font-size: 10px; color: #64748b;">${lat.toFixed(5)}°N, ${Math.abs(lon).toFixed(5)}°W</span><br/>
          <span style="font-size: 10px; color: #10b981; font-weight: bold;">● Active Cellular Lock</span>
        </div>
      `)

      mapInstance.current = map
      markerRef.current = marker

      setTimeout(() => {
        map.invalidateSize()
      }, 200)
    } else {
      mapInstance.current.setView([lat, lon], 15)
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lon])
      }
    }

    return () => {
      // Map cleanup handled on unmount
    }
  }, [mapMode, lat, lon, wearer])

  return (
    <div className="hero-concept-card">
      {/* Top Header: DEVICE CONCEPT & View Controls */}
      <div className="concept-header">
        <div className="concept-tag">
          <span className="concept-dot" />
          <span>DEVICE CONCEPT</span>
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
          <span className="concept-index">01 / 03</span>
        </div>
      </div>

      {/* Main Map Stage: Photorealistic 3D Satellite Map Image */}
      <div className="concept-stage">
        {mapMode === 'satellite' ? (
          <div className="tactical-map-viewport">
            <img
              src="/assets/images/realistic_satellite_map.jpg"
              alt="Realistic Satellite GPS Tracking Map"
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

      {/* Card Bottom: Device Label on Left, Floating Location Box on Right */}
      <div className="concept-footer">
        <div className="concept-device-meta">
          <span className="meta-primary">Electronic monitoring device</span>
          <span className="meta-secondary">IMEI: {deviceId} · 4G LTE Active</span>
        </div>

        {/* Floating Location Card matching user screenshot */}
        <div className="floating-location-card">
          <div className="location-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="location-info-text">
            <div className="loc-title">Location Coordinates</div>
            <div className="loc-subtitle">{lat.toFixed(5)}° N, {Math.abs(lon).toFixed(5)}° W</div>
            <div className="loc-subject">Assigned Subject (Case #CASE-C05-01) · Case #{caseNumber}</div>
          </div>
        </div>
      </div>

      {/* Live Vitals Micro Strip */}
      <div className="concept-telemetry-strip">
        <span>🔋 <strong>{battery}%</strong> Batt</span>
        <span>❤️ <strong>{heartRate}</strong> BPM</span>
        <span>👟 <strong>{steps}</strong> Steps</span>
        <span className="status-online-tag" style={{ color: isOnline ? '#10b981' : '#94a3b8' }}>
          ● {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  )
}
