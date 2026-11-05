import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Maximize2,
  Minimize2,
  Radio,
  Compass
} from 'lucide-react'
import type { Device } from '../../services/api'
import { Link } from 'react-router-dom'

interface DashboardLiveMapProps {
  devices: Device[]
  onSelectDevice?: (device: Device) => void
  selectedDeviceId?: number | null
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


  const [mapStyle, setMapStyle] = useState<'standard' | 'humanitarian' | 'voyager'>('standard')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  // Devices that have valid GPS coordinates
  const locatedDevices = devices.filter(d => {
    const lat = d.last_latitude ?? (d as any).latitude
    const lng = d.last_longitude ?? (d as any).longitude
    return lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  })

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return

    // Default center: India / Hyderabad tech hub or first valid device
    const defaultCenter: [number, number] = [17.4483, 78.3915]
    const initialZoom = 12

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: initialZoom,
      zoomControl: false,
    })

    // Custom positioned zoom control (bottom right)
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
      map.remove()
      mapInstanceRef.current = null
      markerGroupRef.current = null
      tileLayerRef.current = null
    }
  }, [])

  // Switch Tile Style
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

  // Update Markers when devices or filters change
  useEffect(() => {
    const map = mapInstanceRef.current
    const markers = markerGroupRef.current
    if (!map || !markers) return

    markers.clearLayers()

    const bounds: [number, number][] = []

    locatedDevices.forEach(device => {
      const isOnline = (device as any).online === true || (device as any).is_online === true || (device as any).is_active === true || String(device.status || (device as any).connection_status || '').toLowerCase() === 'online' || String(device.status || '').toLowerCase() === 'active'
      const isSelected = selectedDeviceId === device.id
      const lat = Number(device.last_latitude ?? (device as any).latitude)
      const lng = Number(device.last_longitude ?? (device as any).longitude)
      bounds.push([lat, lng])

      // Custom HTML Pin Icon
      const pinColor = isOnline ? '#10b981' : '#64748b'
      const pulseHtml = isOnline ? '<div class="pin-pulse"></div>' : ''
      const borderStyle = isSelected ? 'border: 3px solid #19a9f5; transform: scale(1.18);' : 'border: 2px solid #ffffff;'

      const customIcon = L.divIcon({
        className: 'custom-gps-pin',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18],
        html: `
          <div class="pin-wrapper" style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
            ${pulseHtml}
            <div style="width: 22px; height: 22px; border-radius: 50%; background: ${pinColor}; ${borderStyle} box-shadow: 0 3px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: bold;">
              ${isOnline ? '●' : '○'}
            </div>
          </div>
        `,
      })

      const marker = L.marker([lat, lng], { icon: customIcon })

      const popupContent = document.createElement('div')
      popupContent.className = 'map-popup-card'
      popupContent.innerHTML = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4; min-width: 200px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">
            <strong style="color: #0f172a; font-size: 14px;">${device.device_name || 'Custody Band'}</strong>
            <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 9999px; background: ${isOnline ? '#dcfce7' : '#f1f5f9'}; color: ${isOnline ? '#15803d' : '#64748b'};">
              ${isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div style="color: #475569; font-size: 11px; margin-bottom: 4px;">
            <strong>IMEI:</strong> ${device.imei || 'N/A'}
          </div>
          <div style="color: #475569; font-size: 11px; margin-bottom: 4px;">
            <strong>Battery:</strong> ${device.battery_pct != null ? device.battery_pct + '%' : '—'}
          </div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 8px;">
            <strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
          <a href="/admin/monitoring-center?device=${device.id}" style="display: block; text-align: center; background: #0284c7; color: #ffffff; text-decoration: none; padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;">
            Track in Monitoring Center &rarr;
          </a>
        </div>
      `

      marker.bindPopup(popupContent)
      marker.on('click', () => {
        onSelectDevice?.(device)
      })

      marker.addTo(markers)
    })

    // If we have located devices, fit the map view nicely
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 14, { animate: true })
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: true })
      }
    }
  }, [devices, selectedDeviceId])

  // Recenter / fit bounds
  const handleRecenter = () => {
    if (!mapInstanceRef.current) return
    if (locatedDevices.length > 0) {
      const bounds: [number, number][] = locatedDevices.map(d => [Number(d.last_latitude ?? (d as any).latitude), Number(d.last_longitude ?? (d as any).longitude)])
      if (bounds.length === 1) {
        mapInstanceRef.current.setView(bounds[0], 14)
      } else {
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] })
      }
    } else {
      mapInstanceRef.current.setView([17.4483, 78.3915], 12)
    }
  }

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
            </p>
          </div>
        </div>

        

        {/* Map View & Control Actions */}
        <div className="map-controls-group">
          {/* Layer switcher */}
          <select
            className="map-layer-select"
            value={mapStyle}
            onChange={e => setMapStyle(e.target.value as any)}
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
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.4);
          animation: mapPulse 2s infinite ease-out;
        }
        @keyframes mapPulse {
          0% { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
