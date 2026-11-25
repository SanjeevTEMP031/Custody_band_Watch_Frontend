import { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { Alert as MuiAlert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material'
import {
  Menu,
  Bell,
  LogOut,
  ChevronDown,
  User as UserIcon,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { RootState } from '../../store/store'
import { logout } from '../../store/authSlice'
import {
  acknowledgeGeofenceAlert,
  clearAccessToken,
  getApiWebSocketUrl,
  getGeofenceAlerts,
  acknowledgeAlert,
  listAlerts,
} from '../../services/api'
import Sidebar from './Sidebar'
import PoweredByFooter from '../common/PoweredByFooter'
import {
  enableAlertAudio,
  playAlertSound,
  startAlertAlarm,
  stopAlertAlarm,
  setAlertAudioEnabled,
  subscribeToAlertAudioSetting,
} from '../../utils/alertSounds'
import './appshell.css'

type LiveEvent = Record<string, unknown>

function asLiveEvent(value: unknown): LiveEvent | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as LiveEvent
    : null
}

function liveEventString(event: LiveEvent, ...keys: string[]): string {
  for (const key of keys) {
    const value = event[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function liveEventId(event: LiveEvent): string {
  const identifier = liveEventString(event, 'event_id', 'alert_id', 'journey_alert_id', 'notification_id', 'id')
  if (identifier) return identifier
  const type = liveEventString(event, 'event_type', 'alert_type', 'type')
  const deviceId = liveEventString(event, 'device_id', 'imei')
  const journeyId = liveEventString(event, 'journey_id')
  const timestamp = liveEventString(event, 'event_time', 'created_at', 'timestamp')
  return type && (deviceId || journeyId) && timestamp
    ? `${deviceId}:${journeyId}:${type}:${timestamp}`
    : ''
}

/**
 * Geofence alert rows from `/geofences/alerts` can arrive without an event_type
 * (the backend joins it from geofence_events, which may not match). The backend
 * always sets a title ("Outside Geofence" / "Inside Geofence") and a message, so
 * derive the transition from those when no explicit type is present.
 */
function derivedGeofenceType(event: LiveEvent): string {
  const text = `${liveEventString(event, 'title')} ${liveEventString(event, 'message')}`.toUpperCase()
  if (text.includes('OUTSIDE GEOFENCE') || /\bEXITED\b/.test(text)) return 'GEOFENCE_EXIT'
  if (text.includes('INSIDE GEOFENCE') || /\bENTERED\b/.test(text)) return 'GEOFENCE_ENTRY'
  return ''
}

function liveEventType(event: LiveEvent): string {
  const candidates = ['event_type', 'alert_type', 'type', 'raw_event_code']
    .map(key => liveEventString(event, key).toUpperCase())
    .filter(Boolean)
  const geofenceType = candidates.find(value => value.includes('GEOFENCE'))
  if (geofenceType) return geofenceType
  if (candidates[0]) return candidates[0]
  return hasGeofenceReference(event) ? derivedGeofenceType(event) || 'GEOFENCE_EVENT' : ''
}

function hasGeofenceReference(event: LiveEvent): boolean {
  return liveEventString(event, 'geofence_id', 'geofence_alert_id') !== '' ||
    liveEventString(event, 'source').toUpperCase() === 'GEOFENCE_ENGINE'
}

/** Backend broadcasts that are state/telemetry updates, never operator alerts. */
const NON_ALERT_EVENT_TYPES = new Set([
  'JOURNEY_LIVE_UPDATE',
  'ROUTE_REJOINED',
  'GEOFENCE_ALERT_ACKNOWLEDGED',
  'GEOFENCE_ALERT_RESOLVED',
])

/** Journey start / end notifications: informational, dismissed locally (no backend alert record). */
function canonicalLifecycleType(event: LiveEvent): string {
  const type = liveEventType(event)
  if (type === 'JOURNEY_STARTED' || type === 'JOURNEY_START') return 'JOURNEY_STARTED'
  if (['JOURNEY_COMPLETED', 'JOURNEY_ENDED', 'JOURNEY_END', 'DESTINATION_ARRIVAL'].includes(type)) return 'JOURNEY_COMPLETED'
  return ''
}

function isJourneyLifecycleEvent(event: LiveEvent): boolean {
  return canonicalLifecycleType(event) !== ''
}

function isGeofenceEvent(event: LiveEvent): boolean {
  return liveEventType(event).includes('GEOFENCE') ||
    ['EXCLUSION_ZONE_BREACH', 'EXCLUSION_ZONE_CLEARED'].includes(liveEventType(event)) ||
    hasGeofenceReference(event)
}

function isJourneyMonitoringEvent(event: LiveEvent): boolean {
  const type = liveEventString(event, 'event_type', 'alert_type', 'type').toUpperCase()
  return type.includes('JOURNEY') ||
    type.includes('ROUTE_DEVIATION') ||
    type.includes('ROUTE_REJOINED') ||
    type.includes('DESTINATION_ARRIVAL') ||
    type.includes('UNAUTHORIZED_DEPARTURE') ||
    type.includes('DELAYED_START') ||
    type.includes('OVERDUE_ARRIVAL')
}

function isMonitoringAlertEvent(event: LiveEvent): boolean {
  return isGeofenceEvent(event) || isJourneyMonitoringEvent(event)
}

/** Any geofence entry / exit / breach is surfaced to the operator (inside and outside). */
function isGeofenceTransitionAlert(event: LiveEvent): boolean {
  if (!isGeofenceEvent(event)) return false
  const type = liveEventType(event)
  if (NON_ALERT_EVENT_TYPES.has(type)) return false
  const status = liveEventString(event, 'violation_status', 'zone_state', 'status').toUpperCase()
  return type.includes('VIOLATION') ||
    type.includes('BREACH') ||
    type.includes('ENTRY') ||
    type.includes('REENTRY') ||
    type.includes('EXIT') ||
    type.includes('CLEARED') ||
    type === 'GEOFENCE_EVENT' ||
    status === 'VIOLATION'
}

function isConfirmedJourneyAlert(event: LiveEvent): boolean {
  return isJourneyMonitoringEvent(event) &&
    !NON_ALERT_EVENT_TYPES.has(liveEventType(event)) &&
    isUnresolvedLiveAlert(event)
}

/** All identifiers a backend record may be referenced by (WS payload, geofence row, core alert). */
function liveEventIds(event: LiveEvent): Set<string> {
  const ids = new Set<string>()
  ;['event_id', 'alert_id', 'core_alert_id', 'geofence_alert_id', 'journey_alert_id', 'id'].forEach(key => {
    const value = liveEventString(event, key)
    if (value) ids.add(value)
  })
  const fallback = liveEventId(event)
  if (fallback) ids.add(fallback)
  return ids
}

function liveEventTime(event: LiveEvent): number {
  const parsed = Date.parse(liveEventString(event, 'event_time', 'timestamp', 'created_at'))
  return Number.isFinite(parsed) ? parsed : 0
}

function geofenceAlarmTitle(event: LiveEvent): string {
  const type = liveEventType(event)
  const fenceType = liveEventString(event, 'fence_type', 'geofence_type').toUpperCase()
  if (type.includes('VIOLATION') || type.includes('BREACH') ||
    (fenceType === 'EXCLUSION' && type.includes('ENTRY'))) return 'GEOFENCE VIOLATION'
  if (type.includes('EXIT') || type.includes('CLEARED')) return 'OUTSIDE GEOFENCE'
  if (type.includes('ENTRY')) return 'INSIDE GEOFENCE'
  return liveEventString(event, 'title').toUpperCase() || 'GEOFENCE ALERT'
}

function requiresAlarm(event: LiveEvent): boolean {
  return event.requires_alarm === true
}

function isUnresolvedLiveAlert(event: LiveEvent): boolean {
  if (isJourneyLifecycleEvent(event)) return true
  if (event.acknowledged === true || event.acknowledged_at != null) return false
  return !['ACKNOWLEDGED', 'RESOLVED', 'CLOSED'].includes(
    liveEventString(event, 'status').toUpperCase()
  )
}

export default function AppShell() {
  const location = useLocation()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const auth = useSelector((state: RootState) => state.auth)

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('trackin360-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [alertCount, setAlertCount] = useState<number>(0)
  const [apiStatus, setApiStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [alertSocketStatus, setAlertSocketStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [alarmEnabled, setAlarmEnabled] = useState(() => {
    try {
      return localStorage.getItem('purview-alarm-sound') === 'true'
    } catch {
      return false
    }
  })
  const [audioError, setAudioError] = useState('')
  const [geofenceAlarm, setGeofenceAlarm] = useState<LiveEvent | null>(null)
  const [geofenceAckError, setGeofenceAckError] = useState('')
  const [acknowledgingGeofenceAlarm, setAcknowledgingGeofenceAlarm] = useState(false)
  const seenAlertIds = useRef<Set<string>>(new Set())
  const seenMonitoringAlertIds = useRef<Set<string>>(new Set())
  const initialAlertsLoaded = useRef(false)
  const alarmEnabledRef = useRef(alarmEnabled)
  const geofenceAlarmIdRef = useRef<string | null>(null)
  const geofenceAlarmIdsRef = useRef<Set<string>>(new Set())
  const geofenceAlarmEventRef = useRef<LiveEvent | null>(null)
  const silencedGeofenceAlarmIds = useRef<Set<string>>(new Set())

  useEffect(() => subscribeToAlertAudioSetting(setAlarmEnabled), [])
  useEffect(() => {
    alarmEnabledRef.current = alarmEnabled
  }, [alarmEnabled])

  const clearGeofenceAlarm = useCallback(() => {
    stopAlertAlarm()
    geofenceAlarmIdRef.current = null
    geofenceAlarmIdsRef.current = new Set()
    geofenceAlarmEventRef.current = null
    setGeofenceAlarm(null)
  }, [])

  const activateGeofenceAlarm = useCallback((event: LiveEvent) => {
    const eventId = liveEventId(event)
    if (!eventId || !isMonitoringAlertEvent(event)) return
    const ids = liveEventIds(event)
    const matchesCurrent = [...ids].some(id => geofenceAlarmIdsRef.current.has(id))
    const type = liveEventType(event)
    const current = geofenceAlarmEventRef.current

    // Backend says the device is back on route: clear an open route-deviation popup for it.
    if (type === 'ROUTE_REJOINED' && current &&
      liveEventType(current).includes('ROUTE_DEVIATION') &&
      liveEventString(current, 'device_id', 'imei') === liveEventString(event, 'device_id', 'imei')) {
      clearGeofenceAlarm()
      return
    }
    if (!isUnresolvedLiveAlert(event)) {
      if (matchesCurrent) clearGeofenceAlarm()
      ids.forEach(id => seenMonitoringAlertIds.current.add(id))
      return
    }
    if (!isGeofenceTransitionAlert(event) && !isConfirmedJourneyAlert(event)) return
    if ([...ids].some(id => seenMonitoringAlertIds.current.has(id)) && !matchesCurrent) return
    ids.forEach(id => seenMonitoringAlertIds.current.add(id))

    // The same incident can arrive via WS (no alert_id) and via polling (core alert_id).
    // Keep the open popup if it is the same device + type + fence, and never let an
    // older record replace a newer one.
    const sameLifecycle = current !== null && isJourneyLifecycleEvent(event) &&
      canonicalLifecycleType(current) === canonicalLifecycleType(event) &&
      liveEventString(current, 'journey_id') === liveEventString(event, 'journey_id')
    const sameIncident = sameLifecycle || (current !== null &&
      liveEventType(current) === type &&
      liveEventString(current, 'device_id', 'imei') === liveEventString(event, 'device_id', 'imei') &&
      liveEventString(current, 'geofence_id') === liveEventString(event, 'geofence_id') &&
      Math.abs(liveEventTime(current) - liveEventTime(event)) < 5 * 60 * 1000)
    if (matchesCurrent || sameIncident) {
      ids.forEach(id => geofenceAlarmIdsRef.current.add(id))
      return
    }
    if (current && liveEventTime(event) && liveEventTime(event) < liveEventTime(current)) return

    stopAlertAlarm()
    geofenceAlarmIdRef.current = eventId
    geofenceAlarmIdsRef.current = new Set(ids)
    geofenceAlarmEventRef.current = event
    silencedGeofenceAlarmIds.current.delete(eventId)
    setGeofenceAckError('')
    setGeofenceAlarm(event)
    if (!alarmEnabledRef.current) return
    if (requiresAlarm(event)) {
      startAlertAlarm(liveEventString(event, 'severity') || 'CRITICAL')
    } else {
      playAlertSound(liveEventString(event, 'severity') || 'MEDIUM')
    }
  }, [clearGeofenceAlarm])

  // Journey start/end detected by pages that poll journey status (works even if the backend
  // does not broadcast lifecycle events). Shares event_id with the backend broadcast, so it is deduped.
  useEffect(() => {
    const handleLifecycle = (event: Event) => {
      const detail = asLiveEvent((event as CustomEvent<unknown>).detail)
      if (detail) activateGeofenceAlarm(detail)
    }
    window.addEventListener('trackguard:journey-lifecycle', handleLifecycle)
    return () => window.removeEventListener('trackguard:journey-lifecycle', handleLifecycle)
  }, [activateGeofenceAlarm])

  /** Polled lists are newest-first; activate oldest → newest so the latest incident stays on screen. */
  const activateFromList = useCallback((events: LiveEvent[]) => {
    [...events]
      .sort((first, second) => liveEventTime(first) - liveEventTime(second))
      .forEach(activateGeofenceAlarm)
  }, [activateGeofenceAlarm])

  // Keep the application-wide alert count and notification socket alive on every page.
  useEffect(() => {
    let disposed = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let reconnectDelayMs = 1000

    const refreshAlerts = () => {
      listAlerts(0, 100).then(alerts => {
        if (disposed) return
        setApiStatus('online')
        const active = alerts.filter(alert => (alert.status || '').toLowerCase() !== 'resolved')
        setAlertCount(active.length)
        activateFromList(active
          .map(alert => alert as unknown as LiveEvent)
          .filter(alert => isJourneyMonitoringEvent(alert) && !isGeofenceEvent(alert)))
        if (!initialAlertsLoaded.current) {
          active.forEach(alert => {
            const id = alert.id ?? alert.alert_id
            if (id != null) seenAlertIds.current.add(String(id))
          })
          initialAlertsLoaded.current = true
        }
      }).catch(error => {
        if (!disposed) {
          setApiStatus('offline')
          console.error('[AlertCenter] Unable to refresh alert count:', error)
        }
      })
      getGeofenceAlerts({ skip: 0, limit: 100 }).then(alerts => {
        if (disposed) return
        activateFromList(alerts.map(alert => alert as unknown as LiveEvent))
      }).catch(error => {
        if (!disposed) console.error('[AlertCenter] Unable to refresh geofence alerts:', error)
      })
    }
    const handleGeofenceRefresh = () => refreshAlerts()
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return
      const delay = reconnectDelayMs
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (disposed) return
      setAlertSocketStatus('connecting')
      document.documentElement.dataset.alertSocket = 'connecting'
      try {
        const wsUrl = getApiWebSocketUrl('/alerts/live')
        const socket = new WebSocket(wsUrl)
        ws = socket
        socket.onopen = () => {
          if (disposed) return
          reconnectDelayMs = 1000
          setAlertSocketStatus('connected')
          document.documentElement.dataset.alertSocket = 'connected'
          window.dispatchEvent(new CustomEvent('trackguard:alert-socket', { detail: { connected: true } }))
          refreshAlerts()
        }
        socket.onmessage = event => {
          try {
            const payload = asLiveEvent(JSON.parse(event.data))
            if (!payload) return
            const type = liveEventString(payload, 'type').toUpperCase()
            const data = asLiveEvent(payload.data)
            const nestedAlert = asLiveEvent(payload.alert ?? payload.event ?? data?.alert ?? data?.event ?? payload.data)
            if ((type === 'ALERT_NEW' || type === 'ALERT_UPDATE') && nestedAlert) {
              if (isGeofenceEvent(nestedAlert)) {
                window.dispatchEvent(new CustomEvent('trackguard:geofence-live-alert', { detail: nestedAlert }))
                activateGeofenceAlarm(nestedAlert)
              } else if (isJourneyMonitoringEvent(nestedAlert)) {
                window.dispatchEvent(new CustomEvent('trackguard:journey-live-alert', { detail: nestedAlert }))
                activateGeofenceAlarm(nestedAlert)
              }
              if (type === 'ALERT_NEW') {
                const id = liveEventId(nestedAlert)
                if (id && !seenAlertIds.current.has(id)) {
                  seenAlertIds.current.add(id)
                  if (
                    !isMonitoringAlertEvent(nestedAlert) &&
                    isUnresolvedLiveAlert(nestedAlert)
                  ) playAlertSound(liveEventString(nestedAlert, 'severity') || 'HIGH')
                }
              }
              refreshAlerts()
            } else if (
              type.startsWith('GEOFENCE_') ||
              type.startsWith('JOURNEY_') ||
              type.startsWith('ROUTE_DEVIATION') ||
              isMonitoringAlertEvent(payload)
            ) {
              const eventName = isGeofenceEvent(payload) || type.startsWith('GEOFENCE_')
                ? 'trackguard:geofence-live-alert'
                : 'trackguard:journey-live-alert'
              window.dispatchEvent(new CustomEvent(eventName, { detail: payload }))
              activateGeofenceAlarm(payload)
              if (type !== 'JOURNEY_LIVE_UPDATE') refreshAlerts()
            } else if (type === 'ALERT_UPDATE') {
              refreshAlerts()
            }
          } catch (error) {
            console.error('[AlertCenter] Could not process live alert event:', error)
          }
        }
        socket.onclose = () => {
          if (disposed) return
          setAlertSocketStatus('disconnected')
          document.documentElement.dataset.alertSocket = 'disconnected'
          window.dispatchEvent(new CustomEvent('trackguard:alert-socket', { detail: { connected: false } }))
          scheduleReconnect()
        }
        socket.onerror = () => {
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
            socket.close()
          }
        }
      } catch (error) {
        if (disposed) return
        setAlertSocketStatus('disconnected')
        document.documentElement.dataset.alertSocket = 'disconnected'
        window.dispatchEvent(new CustomEvent('trackguard:alert-socket', { detail: { connected: false } }))
        console.error('[AlertCenter] Unable to connect to live alerts:', error)
        scheduleReconnect()
      }
    }

    refreshAlerts()
    pollTimer = setInterval(refreshAlerts, 30000)
    window.addEventListener('trackguard:geofence-alert-refresh', handleGeofenceRefresh)
    connect()
    return () => {
      disposed = true
      if (pollTimer) clearInterval(pollTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      window.removeEventListener('trackguard:geofence-alert-refresh', handleGeofenceRefresh)
      document.documentElement.dataset.alertSocket = 'disconnected'
    }
  }, [activateFromList, activateGeofenceAlarm])

  const handleToggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('trackin360-sidebar-collapsed', String(next))
      } catch (error) {
        console.error('[AppShell] Unable to save sidebar preference:', error)
      }
      return next
    })
  }

  const handleLogout = () => {
    clearAccessToken()
    dispatch(logout())
    navigate('/admin/login', { replace: true })
  }

  const toggleAlarm = async () => {
    setAudioError('')
    try {
      if (alarmEnabled) {
        setAlertAudioEnabled(false)
        setAlarmEnabled(false)
        stopAlertAlarm()
        return
      }
      await enableAlertAudio()
      setAlertAudioEnabled(true)
      setAlarmEnabled(true)
      if (
        geofenceAlarm &&
        liveEventId(geofenceAlarm) !== '' &&
        !silencedGeofenceAlarmIds.current.has(liveEventId(geofenceAlarm)) &&
        requiresAlarm(geofenceAlarm)
      ) {
        startAlertAlarm(liveEventString(geofenceAlarm, 'severity') || 'CRITICAL')
      } else {
        playAlertSound('MEDIUM')
      }
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Unable to update the alert audio setting.')
    }
  }

  const silenceGeofenceAlarm = () => {
    const id = geofenceAlarm ? liveEventId(geofenceAlarm) : ''
    if (id) silencedGeofenceAlarmIds.current.add(id)
    stopAlertAlarm()
  }

  const acknowledgeGeofenceViolation = async () => {
    if (!geofenceAlarm) return
    const alertId = liveEventString(geofenceAlarm, 'alert_id', 'id', 'event_id')
    if (!alertId) {
      setGeofenceAckError('This event has no backend alert ID to acknowledge.')
      return
    }
    setAcknowledgingGeofenceAlarm(true)
    setGeofenceAckError('')
    try {
      if (isGeofenceEvent(geofenceAlarm)) {
        await acknowledgeGeofenceAlert(alertId, 'Acknowledged by operator')
      } else {
        await acknowledgeAlert(alertId, 'Acknowledged by operator')
      }
      clearGeofenceAlarm()
      window.dispatchEvent(new Event('trackguard:geofence-alert-refresh'))
    } catch (error) {
      setGeofenceAckError(error instanceof Error ? error.message : 'Unable to acknowledge the monitoring alert.')
    } finally {
      setAcknowledgingGeofenceAlarm(false)
    }
  }

  // Derive readable page title
  const getPageTitle = () => {
    const p = location.pathname
    if (p.includes('/admin/dashboard')) return 'Enterprise Dashboard'
    if (p.includes('/admin/device-management')) return 'Device Management'
    if (p.includes('/admin/location-history') || p.includes('/admin/journeys') || p.includes('/admin/route-map')) return 'Location History & Route Tracking'
    if (p.includes('/admin/monitoring-center') || p.includes('/admin/live-people')) return 'Monitoring Center'
    if (p.includes('/admin/geofence') || p.includes('/admin/geofences')) return 'Geofence Security'
    if (p.includes('/admin/alerts') || p.includes('/admin/notifications')) return 'Security Alerts'
    if (p.includes('/admin/device-statistics') || p.includes('/admin/alarm-statistics')) return 'Statistics Center'
    if (p.includes('/admin/self-help-integration') || p.includes('/admin/redeem-voucher')) return 'Self-Service Portal'
    if (p.includes('/admin/reports')) return 'Information & Reports'
    if (p.includes('/admin/settings')) return 'System Settings'
    if (p.includes('/admin/health-data')) return 'Biometric Health Data'
    if (p.includes('/admin/add-device')) return 'Register New Device'
    return 'TrackGuard 360'
  }

  const userDisplayName = auth.user?.name || 'TrackGuard 360 Admin'
  const userRole = auth.user?.role || 'Super Admin'
  const geofenceAlarmDeviceId = geofenceAlarm
    ? liveEventString(geofenceAlarm, 'device_id', 'imei')
    : ''
  const geofenceAlarmFenceId = geofenceAlarm
    ? liveEventString(geofenceAlarm, 'geofence_id')
    : ''
  const geofenceMapParams = new URLSearchParams()
  if (geofenceAlarmDeviceId) geofenceMapParams.set('device', geofenceAlarmDeviceId)
  if (geofenceAlarmFenceId) geofenceMapParams.set('geofence', geofenceAlarmFenceId)
  const journeyAlarmId = geofenceAlarm ? liveEventString(geofenceAlarm, 'journey_id') : ''
  const geofenceAlarmIsLifecycle = geofenceAlarm ? isJourneyLifecycleEvent(geofenceAlarm) : false
  const geofenceMapHref = isGeofenceEvent(geofenceAlarm ?? {})
    ? `/admin/geofences${geofenceMapParams.size ? `?${geofenceMapParams.toString()}` : ''}`
    : `/admin/location-history${geofenceAlarmDeviceId ? `?device=${encodeURIComponent(geofenceAlarmDeviceId)}` : ''}${journeyAlarmId ? `${geofenceAlarmDeviceId ? '&' : '?'}journey=${encodeURIComponent(journeyAlarmId)}` : ''}`
  const liveServicesConnected = apiStatus === 'online' && alertSocketStatus === 'connected'

  return (
    <div className="trackin-app-layout">
      {/* 1. Left Fixed Collapsible Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        alertCount={alertCount}
      />

      {/* 2. Main Wrapper with Dynamic Margin */}
      <div className={'app-main-viewport ' + (collapsed ? 'sidebar-collapsed' : 'sidebar-expanded')}>
        {/* Modern Top Header Bar */}
        <header className="app-top-header">
          <div className="header-left">
            <button
              type="button"
              className="mobile-hamburger-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open mobile navigation"
            >
              <Menu size={22} />
            </button>

            <div className="header-breadcrumb-wrap">
              <span className="breadcrumb-sub">Platform</span>
              <span className="breadcrumb-sep">/</span>
              <h1 className="header-page-title">{getPageTitle()}</h1>
            </div>
          </div>

          <div className="header-right">
            {/* Live System Status Pill */}
            <div
              className={`system-status-pill${liveServicesConnected ? '' : ' status-offline'}`}
              title={`API ${apiStatus}; alert WebSocket ${alertSocketStatus}`}
            >
              <span className={`status-pulse-dot${liveServicesConnected ? '' : ' status-pulse-dot-offline'}`} />
              <span className="status-text">
                {apiStatus === 'offline'
                  ? 'API Offline'
                  : apiStatus === 'connecting'
                    ? 'Connecting'
                    : alertSocketStatus === 'connected'
                      ? 'Live Ops'
                      : 'Alerts Reconnecting'}
              </span>
            </div>

            <button
              type="button"
              className="header-alert-btn"
              onClick={() => void toggleAlarm()}
              title={audioError || (alarmEnabled ? 'Disable alert sounds' : 'Enable alert sounds')}
              aria-label={alarmEnabled ? 'Disable alert sounds' : 'Enable alert sounds'}
            >
              {alarmEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>

            {/* Quick Alerts Bell */}
            <Link
              to="/admin/alerts"
              className="header-alert-btn"
              title={alertCount > 0 ? (alertCount + ' Active Alerts') : 'No Active Alerts'}
            >
              <Bell size={19} />
              {alertCount > 0 && (
                <span className="header-alert-badge">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </Link>

            {/* User Profile Capsule */}
            <div className="user-profile-menu-wrap">
              <button
                type="button"
                className="user-profile-capsule"
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-expanded={userDropdownOpen}
              >
                <div className="user-avatar-circle">
                  {userDisplayName.charAt(0).toUpperCase()}
                </div>
                <div className="user-info-text">
                  <span className="user-name">{userDisplayName}</span>
                  <span className="user-role">{userRole}</span>
                </div>
                <ChevronDown size={15} className="user-dropdown-arrow" />
              </button>

              {userDropdownOpen && (
                <>
                  <div
                    className="dropdown-overlay"
                    onClick={() => setUserDropdownOpen(false)}
                  />
                  <div className="user-dropdown-card">
                    <div className="dropdown-user-header">
                      <strong>{userDisplayName}</strong>
                      <span>{auth.user?.email || 'admin@example.com'}</span>
                    </div>
                    <div className="dropdown-divider" />
                    <Link
                      to="/admin/settings"
                      className="dropdown-item"
                      onClick={() => setUserDropdownOpen(false)}
                    >
                      <UserIcon size={16} />
                      <span>Account Settings</span>
                    </Link>
                    <button
                      type="button"
                      className="dropdown-item text-danger"
                      onClick={() => {
                        setUserDropdownOpen(false)
                        handleLogout()
                      }}
                    >
                      <LogOut size={16} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {audioError && (
            <div role="alert" style={{ position: 'absolute', right: 24, top: 62, zIndex: 1200, background: '#fff7ed', color: '#9a3412', padding: '8px 12px', border: '1px solid #fed7aa', borderRadius: 6 }}>
              {audioError}
            </div>
          )}
        </header>

        {/* 3. Page Content Container */}
        <main className="app-page-content">
          <Outlet />
        </main>
        <PoweredByFooter />
      </div>
      {geofenceAlarm && (
        <Box sx={{ position: 'fixed', top: 88, right: 20, zIndex: 1600, width: { xs: 'calc(100vw - 32px)', sm: 460 } }}>
          <MuiAlert
            severity={geofenceAlarmIsLifecycle ? 'success' : 'error'}
            variant="filled"
            sx={{ alignItems: 'flex-start', boxShadow: 6 }}
          >
            <AlertTitle sx={{ fontWeight: 800 }}>
              {isGeofenceEvent(geofenceAlarm)
                ? geofenceAlarmTitle(geofenceAlarm)
                : canonicalLifecycleType(geofenceAlarm) === 'JOURNEY_STARTED'
                  ? 'JOURNEY STARTED'
                  : canonicalLifecycleType(geofenceAlarm) === 'JOURNEY_COMPLETED'
                    ? 'JOURNEY COMPLETED'
                    : liveEventString(geofenceAlarm, 'event_type', 'alert_type', 'type')
                      .replace(/_/g, ' ') || 'JOURNEY MONITORING ALERT'}
            </AlertTitle>
            <Typography variant="body2">
              Device: {liveEventString(geofenceAlarm, 'device_name', 'device_id', 'imei') || 'Device'}
            </Typography>
            {isGeofenceEvent(geofenceAlarm) ? (
              <Typography variant="body2">
                Geofence: {liveEventString(geofenceAlarm, 'geofence_name') || 'Geofence'}
              </Typography>
            ) : (
              <Typography variant="body2">
                Journey: {liveEventString(geofenceAlarm, 'journey_id') || '—'}
              </Typography>
            )}
            {liveEventString(geofenceAlarm, 'message') && (
              <Typography variant="body2">
                {liveEventString(geofenceAlarm, 'message')}
              </Typography>
            )}
            <Typography variant="body2">
              {geofenceAlarmIsLifecycle ? 'Time' : 'Severity'}: {geofenceAlarmIsLifecycle
                ? (liveEventTime(geofenceAlarm) ? new Date(liveEventTime(geofenceAlarm)).toLocaleString() : '—')
                : liveEventString(geofenceAlarm, 'severity') || '—'}
              {requiresAlarm(geofenceAlarm) ? ' · Audible alarm required' : ''}
            </Typography>
            {geofenceAckError && <Typography role="alert" variant="caption" sx={{ display: 'block', mt: 1 }}>{geofenceAckError}</Typography>}
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              <Button component={Link} to={geofenceMapHref} size="small" variant="outlined" color="inherit">
                View Location
              </Button>
              {geofenceAlarmIsLifecycle ? (
                <Button size="small" variant="contained" color="inherit" onClick={clearGeofenceAlarm}>
                  Dismiss
                </Button>
              ) : (
                <>
                  <Button size="small" variant="outlined" color="inherit" onClick={silenceGeofenceAlarm}>
                    Silence Alarm
                  </Button>
                  <Button size="small" variant="contained" color="inherit" disabled={acknowledgingGeofenceAlarm} onClick={() => void acknowledgeGeofenceViolation()}>
                    {acknowledgingGeofenceAlarm ? 'Acknowledging…' : 'Acknowledge Alert'}
                  </Button>
                </>
              )}
            </Stack>
          </MuiAlert>
        </Box>
      )}
    </div>
  )
}
