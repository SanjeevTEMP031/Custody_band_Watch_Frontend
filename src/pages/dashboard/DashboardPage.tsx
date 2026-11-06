import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert as MuiAlert, CircularProgress } from '@mui/material'
import {
  Smartphone,
  Wifi,
  WifiOff,
  AlertTriangle,
  Search,
  MapPin,
  ChevronRight,
  CheckCircle2,
  Volume2,
  VolumeX,
  ExternalLink,
} from 'lucide-react'
import {
  getAccessToken,
  listAlerts,
  listDevices,
  resolveAlert,
  type ApiAlert,
  type Device
} from '../../services/api'
import { useApiData } from '../../hooks/useApiData'
import { useRealtimeDevices } from '../../hooks/useRealtimeDevices'
import AlertLocationDialog from './AlertLocationDialog'
import DashboardLiveMap from './DashboardLiveMap'
import './dashboard.css'

function formatDate(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<ApiAlert | null>(null)
  const [selectedMapDeviceId, setSelectedMapDeviceId] = useState<number | string | null>(null)
  const [actionError, setActionError] = useState('')
  const [busyAlerts, setBusyAlerts] = useState<number[]>([])
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('purview-alarm-sound') === 'true'
    } catch {
      return true
    }
  })
  const [saved, setSaved] = useState(false)

  // Subscribe to real-time Firestore device updates
  const { devices: realtimeDevices, loading: realtimeLoading } = useRealtimeDevices()

  // Load alerts and fallback device data from backend API
  const loadDashboard = useCallback(async () => {
    if (!getAccessToken()) return { devices: [] as Device[], alerts: [] as ApiAlert[] }
    const [devices, alerts] = await Promise.all([listDevices(0, 500), listAlerts(0, 500)])
    return { devices, alerts }
  }, [])

  const { data, loading: apiLoading, error, reload } = useApiData(loadDashboard)

  // Prioritize real-time Firestore devices when available; otherwise use API devices
  const devices = useMemo(() => {
    if (realtimeDevices.length > 0) return realtimeDevices
    return data?.devices ?? []
  }, [realtimeDevices, data])

  const loading = (realtimeLoading && apiLoading) && devices.length === 0
  const alerts = useMemo(
    () => [...(data?.alerts ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    [data]
  )

  const onlineCount = useMemo(
    () => devices.filter(d => {
      if ((d as any).online === true || (d as any).is_online === true || (d as any).is_active === true) return true
      const s = String(d.status || (d as any).connection_status || '').toLowerCase()
      return s === 'online' || s === 'active'
    }).length,
    [devices]
  )
  const offlineCount = devices.length - onlineCount
  const onlinePct = devices.length ? Math.round((onlineCount / devices.length) * 100) : 0
  const offlinePct = devices.length ? (100 - onlinePct) : 0

  const unresolvedAlerts = useMemo(
    () => alerts.filter(a => (a?.status || '').toLowerCase() !== 'resolved'),
    [alerts]
  )

  // Multi-attribute search (by Device Name, IMEI, Person/Wearer Name)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return devices.filter(d => {
      const nameMatch = (d.device_name || '').toLowerCase().includes(q)
      const imeiMatch = (d.imei || '').toLowerCase().includes(q)
      const serialMatch = (d.serial_number || '').toLowerCase().includes(q)
      const personMatch = (
        (d as any).custody_person_name ||
        (d as any).wearer_name ||
        (d as any).person_name ||
        ''
      ).toLowerCase().includes(q)
      return nameMatch || imeiMatch || serialMatch || personMatch
    })
  }, [devices, searchQuery])

  // Resolve alert handler
  const resolve = async (alert: ApiAlert) => {
    setActionError('')
    setBusyAlerts(curr => [...curr, alert.id])
    try {
      await resolveAlert(alert.id)
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to clear this alert.')
    } finally {
      setBusyAlerts(curr => curr.filter(id => id !== alert.id))
    }
  }

  const getDeviceForAlert = (alert: ApiAlert) => {
    return devices.find(d =>
      String(d.id) === String(alert.device_id) ||
      d.serial_number === String(alert.device_id) ||
      d.imei === String(alert.device_id)
    )
  }

  return (
    <div className="enterprise-dashboard">
      {/* Global Alerts / Errors */}
      {error && <MuiAlert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</MuiAlert>}
      {actionError && (
        <MuiAlert severity="error" onClose={() => setActionError('')} sx={{ mb: 2.5, borderRadius: 2 }}>
          {actionError}
        </MuiAlert>
      )}

      {/* 1. OVERVIEW STAT CARDS */}
      <div className="overview-cards-grid">
        {/* Card 1: Total Devices */}
        <div className="overview-card total-devices">
          <div className="card-top-row">
            <span className="card-label">Total Device Count</span>
            <div className="card-icon-wrap total">
              <Smartphone size={20} />
            </div>
          </div>
          <div className="card-metric-value">
            {loading ? <CircularProgress size={26} /> : devices.length}
          </div>
          <div className="card-footer-meta">
            <span className="meta-highlight">Registered hardware</span>
            <span className="meta-sub">Active in fleet</span>
          </div>
        </div>

        {/* Card 2: Online Devices */}
        <div className="overview-card online-devices">
          <div className="card-top-row">
            <span className="card-label">Online Devices</span>
            <div className="card-icon-wrap online">
              <Wifi size={20} />
            </div>
          </div>
          <div className="card-metric-value text-emerald-600">
            {loading ? <CircularProgress size={26} /> : onlineCount}
          </div>
          <div className="card-footer-meta">
            <span className="status-indicator-dot online" />
            <span className="meta-highlight">{onlinePct}% Online</span>
            <span className="meta-sub">Transmitting telemetry</span>
          </div>
        </div>

        {/* Card 3: Offline Devices */}
        <div className="overview-card offline-devices">
          <div className="card-top-row">
            <span className="card-label">Offline Devices</span>
            <div className="card-icon-wrap offline">
              <WifiOff size={20} />
            </div>
          </div>
          <div className="card-metric-value text-slate-600">
            {loading ? <CircularProgress size={26} /> : offlineCount}
          </div>
          <div className="card-footer-meta">
            <span className="status-indicator-dot offline" />
            <span className="meta-highlight">{offlinePct}% Offline</span>
            <span className="meta-sub">Standby / Sleep mode</span>
          </div>
        </div>

        {/* Card 4: Device Alerts */}
        <div className="overview-card alert-devices">
          <div className="card-top-row">
            <span className="card-label">Device Alerts</span>
            <div className="card-icon-wrap alerts">
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="card-metric-value text-rose-600">
            {loading ? <CircularProgress size={26} /> : unresolvedAlerts.length}
          </div>
          <div className="card-footer-meta">
            <span className="status-indicator-dot alert" />
            <span className="meta-highlight">{unresolvedAlerts.length} Active</span>
            <span className="meta-sub">{alerts.length} Total records</span>
          </div>
        </div>
      </div>

      {/* 2. DEVICE SEARCH BAR SECTION */}
      <div className="dashboard-search-section">
        <div className="search-card">
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search by device name, IMEI, or person name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
              aria-label="Search devices"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
              >
                &times;
              </button>
            )}
          </div>

          {/* Instant Search Results Dropdown/List */}
          {searchQuery.trim() !== '' && (
            <div className="search-results-panel">
              <div className="search-results-header">
                <span>Matching Devices ({searchResults.length})</span>
                <span className="search-hint">Click a device to focus or track</span>
              </div>
              {searchResults.length > 0 ? (
                <div className="search-results-list">
                  {searchResults.slice(0, 6).map(device => {
                    const isOnline = (device.status || (device as any).connection_status || '').toLowerCase() === 'online' || (device as any).is_active === true
                    const rawPerson = (device as any).custody_person_name || (device as any).wearer_name || null
                    const person = rawPerson && !String(rawPerson).toLowerCase().includes('demo') ? rawPerson : null
                    const rawDevName = device.device_name || 'Custody Band #' + device.id
                    const devName = String(rawDevName).toLowerCase().includes('demo') ? `Watch #${device.id}` : rawDevName
                    return (
                      <div key={device.id} className="search-result-item">
                        <div className="result-info">
                          <div className="result-title-row">
                            <strong>{devName}</strong>
                            <span className={'status-pill ' + (isOnline ? 'online' : 'offline')}>
                              {isOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>
                          <div className="result-meta-row">
                            <span>IMEI: {device.imei || 'N/A'}</span>
                            {person && <span>&bull; Person: {person}</span>}
                            <span>&bull; Battery: {device.battery_pct != null ? `${device.battery_pct}%` : '—'}</span>
                          </div>
                        </div>
                        <div className="result-actions">
                          {device.last_latitude && device.last_longitude && (
                            <button
                              type="button"
                              className="result-action-btn"
                              onClick={() => {
                                setSelectedMapDeviceId(device.id)
                                window.scrollTo({ top: 380, behavior: 'smooth' })
                              }}
                            >
                              <MapPin size={14} />
                              Map
                            </button>
                          )}
                          <Link
                            to={'/admin/monitoring-center?device=' + device.id}
                            className="result-action-btn primary"
                          >
                            <ExternalLink size={14} />
                            Monitor
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="search-no-results">
                  No devices found matching &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. LIVE TRACKING MAP */}
      <div className="dashboard-map-fullwidth">
        <DashboardLiveMap
          devices={devices}
          selectedDeviceId={selectedMapDeviceId}
          onSelectDevice={dev => setSelectedMapDeviceId(dev.id)}
        />
      </div>

      {/* 5. RECENT ALERTS SECTION */}
      <div className="dashboard-recent-alerts-section">
        <div className="alerts-card">
          <div className="alerts-card-header">
            <div className="alerts-title-group">
              <div className="alerts-header-icon">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3>Recent Alerts</h3>
                <p>Geofence exit alarms, low battery warnings, offline &amp; tamper triggers</p>
              </div>
            </div>

            <div className="alerts-controls-group">
              <div className="sound-toggle-wrap">
                <button
                  type="button"
                  className={'sound-toggle-btn ' + (sound ? 'on' : 'off')}
                  onClick={() => {
                    const next = !sound
                    setSound(next)
                    setSaved(false)
                    try {
                      localStorage.setItem('purview-alarm-sound', String(next))
                      setSaved(true)
                    } catch {}
                  }}
                  title="Toggle alarm audio"
                >
                  {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  <span>Sound {sound ? 'ON' : 'OFF'}</span>
                </button>
                {saved && <span className="sound-saved-pill">Saved</span>}
              </div>

              <Link to="/admin/alerts" className="view-all-alerts-link">
                <span>All Alerts ({alerts.length})</span>
                <ChevronRight size={15} />
              </Link>
            </div>
          </div>

          {/* Alerts Table */}
          <div className="alerts-table-scroll">
            <table className="dashboard-alerts-table">
              <thead>
                <tr>
                  <th>Device / Name</th>
                  <th>Alert Type</th>
                  <th>IMEI</th>
                  <th>Severity</th>
                  <th>Timestamp</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 8).map(alert => {
                  const device = getDeviceForAlert(alert)
                  const rawName =
                    device?.device_name ||
                    alert.device_name ||
                    device?.serial_number ||
                    (alert.device_id != null ? 'Band #' + alert.device_id : 'Hardware Unit')
                  const name = String(rawName).toLowerCase().includes('demo')
                    ? (device?.id ? `Watch #${device.id}` : 'Custody Watch')
                    : rawName
                  const imei = device?.imei || alert.imei || '—'
                  const isResolved = (alert?.status || '').toLowerCase() === 'resolved'
                  const alertMsg = alert.message || alert.type || 'Alert trigger'
                  const isBusy = busyAlerts.includes(alert.id)

                  // Severity class
                  const sev = (alert.severity || '').toLowerCase()
                  const sevClass = sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : 'medium'

                  return (
                    <tr key={alert.id} className={isResolved ? 'row-resolved' : ''}>
                      <td>
                        <div className="alert-device-cell">
                          <Smartphone size={16} className="text-slate-400" />
                          <span className="font-semibold text-slate-900">{name}</span>
                        </div>
                      </td>
                      <td>
                        <span className={'alert-type-badge ' + sevClass}>
                          {alertMsg}
                        </span>
                      </td>
                      <td className="text-slate-600 font-mono text-xs">{imei}</td>
                      <td>
                        <span className={'severity-pill ' + sevClass}>
                          {sev || 'warning'}
                        </span>
                      </td>
                      <td className="text-slate-500 text-xs">{formatDate(alert.created_at)}</td>
                      <td>
                        <div className="alert-row-actions">
                          <button
                            type="button"
                            className="row-action-btn map"
                            onClick={() => setSelectedAlert(alert)}
                            title="View GPS alert location"
                          >
                            <MapPin size={14} />
                            Location
                          </button>

                          {!isResolved && (
                            <button
                              type="button"
                              className="row-action-btn clear"
                              onClick={() => void resolve(alert)}
                              disabled={isBusy}
                              title="Resolve and acknowledge alert"
                            >
                              {isBusy ? <CircularProgress size={13} /> : <CheckCircle2 size={14} />}
                              Clear
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {!loading && alerts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="alerts-empty-cell">
                      <CheckCircle2 size={28} className="text-emerald-500 mb-1" />
                      <div>No active security alerts</div>
                      <p className="text-xs text-slate-400">All custody tracking perimeters and hardware are secure.</p>
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td colSpan={6} className="alerts-loading-cell">
                      <CircularProgress size={24} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Alert GPS Location Dialog */}
      <AlertLocationDialog
        alert={selectedAlert}
        device={selectedAlert ? getDeviceForAlert(selectedAlert) : undefined}
        open={selectedAlert !== null}
        onClose={() => setSelectedAlert(null)}
      />
    </div>
  )
}
