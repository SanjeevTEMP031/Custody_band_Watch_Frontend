import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair } from 'lucide-react'
import { subscribeToDevices } from '../../lib/firebase'
import type { Device } from '../../services/api'

type MapTileStyle = 'standard' | 'satellite' | 'dark'

interface TileConfig {
  name: string
  url: string
  attribution: string
  subdomains?: string[]
}

const tileLayers: Record<MapTileStyle, TileConfig> = {
  standard: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    name: 'Satellite / Aerial',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  },
  dark: {
    name: 'Tactical Dark',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, CyclOSM',
  },
}

export default function LandingMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markerGroup = useRef<L.LayerGroup | null>(null)
  const activeTileLayer = useRef<L.TileLayer | null>(null)

  const [tileStyle, setTileStyle] = useState<MapTileStyle>('standard')
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string>('')

  // Real-time Firestore subscription
  useEffect(() => {
    const unsubscribe = subscribeToDevices(
      (updatedList) => {
        setDevices(updatedList)
        setLastRefreshed(new Date().toLocaleTimeString())
        if (updatedList.length > 0) {
          const located = updatedList.filter(d => d.last_latitude != null && d.last_longitude != null)
          setSelectedDevice(prev => {
            if (prev) {
              const matched = updatedList.find(d => d.id === prev.id)
              if (matched) return matched
            }
            return located[0] ?? updatedList[0]
          })
        } else {
          setSelectedDevice(null)
        }
      },
      (err) => {
        console.error('LandingMap real-time subscription error:', err)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [])

  const createLayer = (style: MapTileStyle) => {
    const config = tileLayers[style]
    const layer = L.tileLayer(config.url, {
      maxZoom: 19,
      subdomains: config.subdomains,
      attribution: config.attribution,
    })
    return layer
  }

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return

    const initialCenter: [number, number] = [20.5937, 78.9629]
    const map = L.map(mapContainer.current, {
      center: initialCenter,
      zoom: 4,
      zoomControl: false,
      attributionControl: false,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const layer = createLayer(tileStyle)
    layer.addTo(map)
    activeTileLayer.current = layer

    const markers = L.layerGroup().addTo(map)
    markerGroup.current = markers

    mapInstance.current = map

    return () => {
      map.remove()
      mapInstance.current = null
      markerGroup.current = null
      activeTileLayer.current = null
    }
  }, [])

  // Handle tile switch
  useEffect(() => {
    if (!mapInstance.current) return
    if (activeTileLayer.current) {
      activeTileLayer.current.remove()
    }
    const layer = createLayer(tileStyle)
    layer.addTo(mapInstance.current)
    activeTileLayer.current = layer
  }, [tileStyle])

  // Update markers when devices change
  useEffect(() => {
    if (!mapInstance.current || !markerGroup.current) return

    markerGroup.current.clearLayers()

    const located = devices.filter(
      d => d.last_latitude != null && d.last_longitude != null && Number.isFinite(d.last_latitude) && Number.isFinite(d.last_longitude)
    )

    located.forEach((dev) => {
      const lat = dev.last_latitude!
      const lon = dev.last_longitude!
      const isOnline = String(dev.status || (dev as any).connection_status || '').toLowerCase() === 'active' || String(dev.status || '').toLowerCase() === 'online'
      const pinColor = isOnline ? '#2563eb' : '#64748b'

      const customIcon = L.divIcon({
        className: 'custom-gps-pin',
        html: `<div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;"><div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: ${isOnline ? 'rgba(37, 99, 235, 0.25)' : 'rgba(100, 116, 139, 0.2)'}; animation: rapidoHalo 2s infinite ease-out;"></div><div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: #ffffff; box-shadow: 0 3px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;"><div style="width: 14px; height: 14px; border-radius: 50%; background: ${pinColor};"></div></div></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22],
      })

      const marker = L.marker([lat, lon], { icon: customIcon })

      const wearerTitle = dev.device_name || (dev as any).wearer_name || dev.serial_number || 'Monitored Band'
      const batteryText = dev.battery_pct != null ? `${dev.battery_pct}%` : 'N/A'
      const hrText = (dev as any).heart_rate_bpm ?? dev.heart_rate != null ? `${(dev as any).heart_rate_bpm ?? dev.heart_rate} BPM` : 'N/A'
      const stepsText = (dev as any).steps ?? dev.step_counter != null ? `${Number((dev as any).steps ?? dev.step_counter).toLocaleString()}` : 'N/A'
      const hasFix = (dev as any).has_gps_fix !== false

      const popupHtml = `
        <div style="font-family: Inter, sans-serif; color: #071a2e; min-width: 220px; padding: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;">
            <strong style="font-size: 13px; color: #1e40af;">${wearerTitle}</strong>
            <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 9999px; background: ${hasFix ? '#dbeafe' : '#fef3c7'}; color: ${hasFix ? '#1e40af' : '#b45309'};">
              ${hasFix ? 'GPS LOCK' : 'NO FIX'}
            </span>
          </div>
          <div style="font-size: 11px; line-height: 1.6; color: #475569;">
            <div><strong>Device IMEI:</strong> <span style="font-family: monospace;">${dev.imei || dev.serial_number || 'N/A'}</span></div>
            <div><strong>Status:</strong> ${dev.status || 'N/A'}</div>
            <div><strong>Coordinates:</strong> ${lat.toFixed(5)}°, ${lon.toFixed(5)}°</div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #e2e8f0; display: flex; gap: 8px;">
              <span>🔋 <strong>${batteryText}</strong></span>
              <span>❤️ <strong>${hrText}</strong></span>
              <span>👟 <strong>${stepsText}</strong></span>
            </div>
          </div>
        </div>
      `

      marker.bindPopup(popupHtml)
      marker.on('click', () => setSelectedDevice(dev))
      marker.addTo(markerGroup.current!)
    })

    if (located.length > 0) {
      if (located.length === 1) {
        mapInstance.current.setView([located[0].last_latitude!, located[0].last_longitude!], 15)
      } else {
        const bounds: [number, number][] = located.map(d => [d.last_latitude!, d.last_longitude!])
        mapInstance.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
      }
    }
  }, [devices])

  const handleCenterOnDevice = () => {
    if (!mapInstance.current || !selectedDevice) return
    if (selectedDevice.last_latitude != null && selectedDevice.last_longitude != null) {
      mapInstance.current.setView([selectedDevice.last_latitude, selectedDevice.last_longitude], 16, { animate: true })
    }
  }

  const locatedCount = devices.filter(d => d.last_latitude != null && d.last_longitude != null).length
  const activeLat = selectedDevice?.last_latitude
  const activeLon = selectedDevice?.last_longitude
  const hasGps = activeLat != null && activeLon != null
  const selectedBattery = selectedDevice?.battery_pct != null ? `${selectedDevice.battery_pct}%` : 'N/A'
  const selectedHr = (selectedDevice as any)?.heart_rate_bpm ?? selectedDevice?.heart_rate
  const selectedSteps = (selectedDevice as any)?.steps ?? selectedDevice?.step_counter

  return (
    <div className="landing-map-wrapper">
      <div className="map-controls-bar">
        <div className="map-status-pill">
          <span className="status-dot online" style={{ background: locatedCount > 0 ? '#2563eb' : '#94a3b8', boxShadow: locatedCount > 0 ? '0 0 8px #2563eb' : 'none' }} />
          <span className="map-status-text">
            <strong>{devices.length} Band{devices.length === 1 ? '' : 's'} Monitored</strong>
            <span> &mdash; {locatedCount > 0 ? `${locatedCount} with Live GPS` : 'No GPS Fix Available'}</span>
          </span>
        </div>

        <div className="map-actions-group">
          <div className="tile-selector">
            {(Object.keys(tileLayers) as MapTileStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                className={'tile-btn ' + (tileStyle === style ? 'active' : '')}
                onClick={() => setTileStyle(style)}
              >
                {tileLayers[style].name}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="landing-map-action-btn"
            onClick={handleCenterOnDevice}
            title="Center map on active device"
            disabled={!hasGps}
          >
            <Crosshair size={14} className="btn-icon" />
            <span>Re-Center</span>
          </button>
        </div>
      </div>

      <div className="map-canvas-container">
        <div ref={mapContainer} className="leaflet-map-canvas" />

        <div className="map-overlay-hud">
          <div className="hud-header">
            <span className="hud-label" style={{ color: '#2563eb' }}>LIVE GPS TRACKING</span>
            <span className="hud-state online" style={{ background: hasGps ? '#dbeafe' : '#f1f5f9', color: hasGps ? '#1e40af' : '#64748b' }}>
              {hasGps ? 'SATELLITE FIX' : 'NO GPS FIX'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Wearer:</span>
            <span className="hud-val"><strong>{selectedDevice?.device_name || (selectedDevice as any)?.wearer_name || selectedDevice?.serial_number || 'N/A'}</strong></span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Device IMEI:</span>
            <span className="hud-val" style={{ fontFamily: 'monospace' }}>{selectedDevice?.imei || selectedDevice?.serial_number || 'N/A'}</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Latitude:</span>
            <span className="hud-val">{hasGps ? `${activeLat!.toFixed(5)}°` : 'N/A'}</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Longitude:</span>
            <span className="hud-val">{hasGps ? `${activeLon!.toFixed(5)}°` : 'N/A'}</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Battery:</span>
            <span className="hud-val">{selectedBattery}</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Heart Rate:</span>
            <span className="hud-val text-rose">{selectedHr != null ? `${selectedHr} BPM` : 'N/A'}</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Steps:</span>
            <span className="hud-val">{selectedSteps != null ? Number(selectedSteps).toLocaleString() : 'N/A'}</span>
          </div>
          <div className="hud-footer">
            <span>Navigation Engine: High-Precision GPS</span>
            {lastRefreshed && <span>Updated: {lastRefreshed}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
