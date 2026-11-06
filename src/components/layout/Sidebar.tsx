import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import {
  Home,
  Smartphone,
  Radio,
  MapPin,
  Bell,
  BarChart3,
  Wrench,
  FileText,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Activity,
  X
} from 'lucide-react'
import { logout } from '../../store/authSlice'
import { clearAccessToken, listAlerts } from '../../services/api'
import './sidebar.css'

export interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  alertCount?: number
}

interface MenuItem {
  id: string
  label: string
  to: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  badge?: number
  subPaths?: string[]
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  alertCount: propAlertCount,
}: SidebarProps) {
  const location = useLocation()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [internalAlertCount, setInternalAlertCount] = useState<number>(0)

  // Fetch or update alerts count if not provided
  useEffect(() => {
    if (typeof propAlertCount === 'number') {
      setInternalAlertCount(propAlertCount)
      return
    }
    let isMounted = true
    listAlerts(0, 100)
      .then(alerts => {
        if (!isMounted) return
        const active = (alerts || []).filter(a => (a.status || '').toLowerCase() !== 'resolved').length
        setInternalAlertCount(active)
      })
      .catch(() => {})
    return () => { isMounted = false }
  }, [propAlertCount, location.pathname])

  const effectiveAlertCount = typeof propAlertCount === 'number' ? propAlertCount : internalAlertCount

  const menuItems: MenuItem[] = [
    {
      id: 'home',
      label: 'Home',
      to: '/admin/dashboard',
      icon: Home,
      subPaths: ['/admin/dashboard']
    },
    {
      id: 'device-mgmt',
      label: 'Device Management',
      to: '/admin/device-management',
      icon: Smartphone,
      subPaths: ['/admin/device-management', '/admin/add-device', '/admin/bulk-sell', '/admin/health-data']
    },
    {
      id: 'monitoring',
      label: 'Monitoring Center',
      to: '/admin/monitoring-center',
      icon: Radio,
      subPaths: ['/admin/monitoring-center', '/admin/live-people', '/admin/location-history', '/admin/journeys']
    },
    {
      id: 'geofence',
      label: 'Geofence',
      to: '/admin/geofence',
      icon: MapPin,
      subPaths: ['/admin/geofence', '/admin/geofences']
    },
    {
      id: 'alerts',
      label: 'Alerts',
      to: '/admin/alerts',
      icon: Bell,
      badge: effectiveAlertCount,
      subPaths: ['/admin/alerts', '/admin/notifications']
    },
    {
      id: 'statistics',
      label: 'Statistics Center',
      to: '/admin/device-statistics',
      icon: BarChart3,
      subPaths: ['/admin/device-statistics', '/admin/alarm-statistics', '/admin/user-statistics']
    },
    {
      id: 'self-service',
      label: 'Self-Service',
      to: '/admin/self-help-integration',
      icon: Wrench,
      subPaths: ['/admin/self-help-integration', '/admin/redeem-voucher']
    },
    {
      id: 'info-center',
      label: 'Information Center',
      to: '/admin/reports',
      icon: FileText,
      subPaths: ['/admin/reports', '/admin/users', '/admin/attendance']
    },
    {
      id: 'settings',
      label: 'Settings',
      to: '/admin/settings',
      icon: Settings,
      subPaths: ['/admin/settings']
    }
  ]

  const handleLogout = () => {
    clearAccessToken()
    dispatch(logout())
    navigate('/admin/login', { replace: true })
  }

  const isItemActive = (item: MenuItem) => {
    if (location.pathname === item.to) return true
    if (item.subPaths && item.subPaths.some(sp => location.pathname.startsWith(sp))) return true
    return false
  }

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={'trackin-sidebar ' + (collapsed ? 'collapsed' : '') + ' ' + (mobileOpen ? 'mobile-open' : '')}
        aria-label="Main Left Sidebar Navigation"
      >
        {/* Sidebar Header & Branding */}
        <div className="sidebar-header">
          <Link to="/admin/dashboard" className="sidebar-brand" onClick={onCloseMobile}>
            <div className="brand-icon-box">
              <Activity size={20} className="brand-pulse-icon" />
              <div className="brand-glow" />
            </div>
            {!collapsed && (
              <div className="brand-text-wrapper">
                <span className="brand-title">
                  Trackin<span className="brand-accent">360</span>
                </span>
                <span className="brand-badge">GPS &amp; MONITORING</span>
              </div>
            )}
          </Link>

          {/* Close button for mobile */}
          <button
            type="button"
            className="sidebar-mobile-close-btn"
            onClick={onCloseMobile}
            aria-label="Close mobile menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Sidebar Navigation Items */}
        <nav className="sidebar-nav">
          <div className="nav-group-title">
            {!collapsed ? 'MAIN MENU' : '•••'}
          </div>

          <ul className="nav-menu-list">
            {menuItems.map(item => {
              const active = isItemActive(item)
              const IconComp = item.icon
              return (
                <li key={item.id} className="nav-menu-item">
                  <Link
                    to={item.to}
                    className={'nav-link ' + (active ? 'active' : '')}
                    onClick={onCloseMobile}
                    title={collapsed ? item.label : undefined}
                  >
                    <div className="nav-link-icon-wrap">
                      <IconComp size={19} className="nav-icon" />
                      {active && <span className="nav-active-glow" />}
                    </div>

                    {!collapsed && (
                      <span className="nav-link-label">{item.label}</span>
                    )}

                    {/* Notification badge for alerts */}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className={'nav-badge ' + (collapsed ? 'collapsed-badge' : '')}>
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Sidebar Footer with Collapse Toggle & Logout */}
        <div className="sidebar-footer">
          {/* Quick collapse/expand button */}
          <button
            type="button"
            className="collapse-toggle-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : (
              <>
                <ChevronLeft size={18} />
                <span className="collapse-toggle-label">Collapse Menu</span>
              </>
            )}
          </button>

          {/* Logout button */}
          <button
            type="button"
            className="sidebar-logout-btn"
            onClick={handleLogout}
            title="Sign out from Trackin360"
          >
            <LogOut size={18} className="logout-icon" />
            {!collapsed && <span className="logout-label">Logout</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
