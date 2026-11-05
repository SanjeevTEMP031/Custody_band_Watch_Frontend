import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, RotateCw } from 'lucide-react'

export interface LiveGpsDevice {
  device_id: string
  wearer_name?: string
  case_number?: string
  battery_percent?: number
  heart_rate_bpm?: number
  steps?: number
  latitude: number
  longitude: number
  connection_status?: string
  last_seen?: string
  last_packet_type?: string
}

export type MapTileStyle = 'standard' | 'humanitarian' | 'cyclosm'

// Subdomains: openstreetmap.fr only supports 'abc' (NOT 'abcd' - 'd' causes ENOTFOUND)
const tileLayers: Record<MapTileStyle, { name: string; url: string; subdomains: string; attribution: string }> = {
  standard: {
    name: 'Standard OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '&copy; OpenStreetMap contributors',
  },
  humanitarian: {
    name: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team',
  },
  cyclosm: {
    name: 'Terrain',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '&copy; OpenStreetMap contributors, CyclOSM',
  },
}

const DEMO_DEVICE: LiveGpsDevice = {
  device_id: '863758******420',
  wearer_name: 'Subject #01 (Supervised)',
  case_number: 'CASE-2026-EM01',
  battery_percent: 92,
  heart_rate_bpm: 72,
  steps: 4120,
  latitude: 40.7128,
  longitude: -74.006,
  connection_status: 'ONLINE',
  last_seen: 'Just now',
  last_packet_type: '0x02_GPS_FIX',
}

const ROUTE_PATH: [number, number][] = [
  [40.7061, -74.0092],
  [40.7082, -74.0055],
  [40.7103, -74.0031],
  [40.7118, -74.0042],
  [40.7128, -74.006],
]

export default function LandingMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markerGroup = useRef<L.LayerGroup | null>(null)
  const activeTileLayer = useRef<L.TileLayer | null>(null)

  const [tileStyle, setTileStyle] = useState<MapTileStyle>('standard')
  const [devices, setDevices] = useState<LiveGpsDevice[]>([DEMO_DEVICE])
  const [selectedDevice, setSelectedDevice] = useState<LiveGpsDevice | null>(DEMO_DEVICE)
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<string>('')

  const fetchLiveDevices = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/devices')
      if (res.ok) {
        const data = await res.json()
        const rawList = Array.isArray(data) ? data : data.devices || []
        if (rawList.length > 0) {
          const mapped: LiveGpsDevice[] = rawList.map((d: any) => ({
            device_id: d.imei || d.device_id || 'Unit #8637',
            wearer_name: d.wearer_name || d.name || 'Subject #01 (Supervised)',
            case_number: d.case_file || d.case_number || 'CASE-2026-EM01',
            battery_percent: typeof d.battery === 'number' ? d.battery : (d.battery_pct ?? 92),
            heart_rate_bpm: d.heart_rate ?? 72,
            steps: d.steps ?? 4120,
            latitude: Number(d.latitude || 40.7128),
            longitude: Number(d.longitude || -74.006),
            connection_status: d.online || d.is_online ? 'ONLINE' : (d.status || 'ONLINE'),
            last_seen: d.last_seen || 'Just now',
            last_packet_type: d.packet_type || '0x02_GPS_FIX',
          }))
          setDevices(mapped)
          setSelectedDevice(mapped[0])
        }
      }
    } catch {
      // Keep demo fallback
    } finally {
      setLoading(false)
      setLastRefreshed(new Date().toLocaleTimeString())
    }
  }

  const createLayer = (style: MapTileStyle) => {
    const config = tileLayers[style]
    const layer = L.tileLayer(config.url, {
      maxZoom: 19,
      subdomains: config.subdomains,
      attribution: config.attribution,
      keepBuffer: 6,
      updateWhenIdle: false,
    })

    // If an external tile drops (e.g. Humanitarian FR server rate limits or drops),
    // immediately swap in OSM tile and force it visible so no gray tiles appear
    layer.on('tileerror', (error) => {
      const img = error.tile as HTMLImageElement
      if (img && !img.dataset.fallback) {
        img.dataset.fallback = 'standard'
        const coords = (error as any).coords
        if (coords) {
          img.onload = () => {
            img.classList.add('leaflet-tile-loaded')
            img.style.visibility = 'visible'
            img.style.opacity = '1'
          }
          img.onerror = () => {
            img.onload = () => {
              img.classList.add('leaflet-tile-loaded')
              img.style.visibility = 'visible'
              img.style.opacity = '1'
            }
            img.src = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/' + coords.z + '/' + coords.x + '/' + coords.y + '.png'
          }
          img.src = 'https://tile.openstreetmap.org/' + coords.z + '/' + coords.x + '/' + coords.y + '.png'
        }
      }
    })

    return layer
  }

  useEffect(() => {
    if (!mapContainer.current) return

    const initialCenter: [number, number] = [40.7128, -74.006]
    const map = L.map(mapContainer.current, {
      center: initialCenter,
      zoom: 15,
      zoomControl: true,
      scrollWheelZoom: true,
    })
    mapInstance.current = map

    const layer = createLayer(tileStyle)
    activeTileLayer.current = layer
    layer.addTo(map)

    L.polyline(ROUTE_PATH, {
      color: '#1d4ed8',
      weight: 6,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    L.polyline(ROUTE_PATH, {
      color: '#2563eb',
      weight: 3.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    markerGroup.current = L.layerGroup().addTo(map)

    setTimeout(() => {
      map.invalidateSize()
    }, 250)

    return () => {
      map.remove()
      mapInstance.current = null
      markerGroup.current = null
      activeTileLayer.current = null
    }
  }, [])

  // Switch Tile Style smoothly: keep previous layer until new layer mounts so no gray flash occurs
  useEffect(() => {
    if (!mapInstance.current) return
    const prevLayer = activeTileLayer.current
    const newLayer = createLayer(tileStyle)
    newLayer.addTo(mapInstance.current)
    activeTileLayer.current = newLayer

    const timer = setTimeout(() => {
      if (prevLayer && mapInstance.current && mapInstance.current.hasLayer(prevLayer)) {
        mapInstance.current.removeLayer(prevLayer)
      }
      mapInstance.current?.invalidateSize({ pan: false })
    }, 250)

    return () => clearTimeout(timer)
  }, [tileStyle])

  useEffect(() => {
    if (!mapInstance.current || !markerGroup.current) return
    markerGroup.current.clearLayers()

    devices.forEach((dev) => {
      const customIcon = L.divIcon({
        className: 'custom-gps-pin',
        html: '<div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;"><div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(37, 99, 235, 0.25); animation: rapidoHalo 2s infinite ease-out;"></div><div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: #ffffff; box-shadow: 0 3px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;"><div style="width: 14px; height: 14px; border-radius: 50%; background: #2563eb;"></div></div></div>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22],
      })

      const marker = L.marker([dev.latitude, dev.longitude], { icon: customIcon })

      const popupHtml = '<div style="font-family: Inter, sans-serif; color: #071a2e; min-width: 220px; padding: 4px;"><div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;"><strong style="font-size: 13px; color: #1e40af;">Subject #01 (Supervised)</strong><span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 9999px; background: #dbeafe; color: #1e40af;">GPS LOCK</span></div><div style="font-size: 11px; line-height: 1.6; color: #475569;"><div><strong>Device IMEI:</strong> <span style="font-family: monospace;">863758******420</span></div><div><strong>Case:</strong> CASE-2026-EM01</div><div><strong>Coordinates:</strong> 40.71280°N, 74.00600°W</div><div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #e2e8f0; display: flex; gap: 8px;"><span>🔋 <strong>92%</strong></span><span>❤️ <strong>72 BPM</strong></span><span>👟 <strong>4,120</strong></span></div></div></div>'

      marker.bindPopup(popupHtml)
      marker.on('click', () => setSelectedDevice(dev))
      marker.addTo(markerGroup.current!)
    })

    if (devices.length > 0) {
      const first = devices[0]
      mapInstance.current.setView([first.latitude, first.longitude], 15)
    }
  }, [devices])

  const handleCenterOnDevice = () => {
    if (!mapInstance.current || !selectedDevice) return
    mapInstance.current.setView([selectedDevice.latitude, selectedDevice.longitude], 16, { animate: true })
  }

  return (
    <div className="landing-map-wrapper">
      <div className="map-controls-bar">
        <div className="map-status-pill">
          <span className="status-dot online" style={{ background: '#2563eb', boxShadow: '0 0 8px #2563eb' }} />
          <span className="map-status-text">
            <strong>2,450 Bands Monitored</strong>
            <span> — Unit #8637 (Live GPS Active)</span>
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
          >
            <Crosshair size={14} className="btn-icon" />
            <span>Re-Center</span>
          </button>

          <button
            type="button"
            className={'landing-map-action-btn ' + (loading ? 'spinning' : '')}
            onClick={fetchLiveDevices}
            title="Refresh GPS Telemetry"
            disabled={loading}
          >
            <RotateCw size={14} className={'btn-icon ' + (loading ? 'spin-icon' : '')} />
            <span>{loading ? 'Updating...' : 'Refresh GPS'}</span>
          </button>
        </div>
      </div>

      <div className="map-canvas-container">
        <div ref={mapContainer} className="leaflet-map-canvas" />

        <div className="map-overlay-hud">
          <div className="hud-header">
            <span className="hud-label" style={{ color: '#2563eb' }}>LIVE GPS TRACKING</span>
            <span className="hud-state online" style={{ background: '#dbeafe', color: '#1e40af' }}>SATELLITE 3D FIX</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Wearer:</span>
            <span className="hud-val"><strong>Subject #01 (Supervised)</strong></span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Case File:</span>
            <span className="hud-val">CASE-2026-EM01</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Device IMEI:</span>
            <span className="hud-val" style={{ fontFamily: 'monospace' }}>863758******420</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Latitude:</span>
            <span className="hud-val">40.712800° N</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Longitude:</span>
            <span className="hud-val">74.006000° W</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Battery:</span>
            <span className="hud-val">92%</span>
          </div>
          <div className="hud-row">
            <span className="hud-key">Heart Rate:</span>
            <span className="hud-val text-rose">72 BPM</span>
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
